package id.itulah.pindai.data

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

/** What a scan result row draws, and nothing more. */
data class ScanIdentity(
    val skuCode: String,
    val name: String,
    val articleCode: String?,
    val colour: String?,
    val size: String?,
    val barcode: String?,
    val basePriceMinor: Long?,
    val active: Boolean,
)

/** One catalogue row as the edge hands it over. */
data class CatalogRow(
    val skuCode: String,
    val name: String,
    val articleCode: String?,
    val divisionCode: String?,
    val barcode: String?,
    val basePriceMinor: Long?,
    val active: Boolean,
)

/** What the local copy is, and where it came from. */
data class CatalogMeta(
    val nodeKey: String,
    val generation: Long,
    val itemCount: Long,
    val contentHash: String,
    val syncedAt: String,
)

/** One finished sweep, as it appears in the history list. */
data class SweepRecord(
    val id: Long,
    val endedAt: String,
    val mode: String,
    val units: Int,
    val skus: Int,
    val articles: Int,
    val unknown: Int,
    val foreign: Int,
    /** Kept at the top of the list because somebody said it matters. */
    val pinned: Boolean = false,
)

/** One frozen, signed-once observation batch waiting for the edge to take it. */
data class OutboxBatch(
    val id: Long,
    val sessionId: String,
    val idempotencyKey: String,
    val body: ByteArray,
    val epcCount: Int,
    val attempts: Int,
)

/**
 * The handheld's own copy of the product master, and its spool of unsent
 * evidence.
 *
 * # Why SQLite, when a file would do for the scan path
 *
 * Nothing on the scan path reads this database. A tag's SKU comes out of the
 * EPC by arithmetic and its article is the SKU's first eight characters, so a
 * sweep of ten thousand units asks the catalogue exactly nothing until the
 * trigger is released. A `HashMap` would serve that.
 *
 * What a map cannot serve is searching the whole catalogue by name or barcode,
 * which is a query over thousands of rows and wants an index. That, and only
 * that, is why there is a database here.
 *
 * # Why not Room
 *
 * Room means an annotation processor and a schema to migrate, for a table whose
 * every row is derived from the server and discarded wholesale when the
 * generation moves. This build is deliberately lean — R8 is already off because
 * the vendor AAR cannot survive it — and KSP is weight that earns nothing here.
 */
class CatalogStore(context: Context) {

    private val helper = object : SQLiteOpenHelper(context.applicationContext, NAME, null, VERSION) {
        override fun onCreate(db: SQLiteDatabase) {
            SCHEMA.forEach(db::execSQL)
        }

        override fun onUpgrade(db: SQLiteDatabase, old: Int, new: Int) {
            // The catalogue is a cache of the centre, so an upgrade drops it and
            // lets the generation gate pull a fresh copy. That is the ONLY thing
            // an upgrade may drop.
            //
            // This used to drop every table, on the reasoning that an update is
            // installed onto a device whose sweep has been finished first. A
            // finished sweep is not a FILED one: the outbox holds evidence until
            // the Edge takes it, which on a shop without wifi is days, and the
            // history is the operator's only record of their own counts. So
            // those are kept, and change shape only by the additive steps
            // below — an app update must never be the thing that loses a count.
            CACHE_DROPS.forEach(db::execSQL)
            if (old < 4) setAsideUnrecorded(db, old)
            // 5: a batch the node refused for good is set aside, visibly, rather
            // than blocking every batch behind it. Every row spooled before this
            // stays exactly as it was, and pending.
            if (old < 5 && hasTable(db, "evidence_outbox") &&
                !hasColumn(db, "evidence_outbox", "refused_status")
            ) {
                db.execSQL("ALTER TABLE evidence_outbox ADD COLUMN refused_status INTEGER")
            }
            onCreate(db)
        }

        /**
         * Version 4 is the first schema this file has a record of. A database
         * older than that has evidence and history in a shape nobody wrote
         * down, so it is not read through a schema it may not match — and it is
         * not dropped either. Each table is kept under another name, where a
         * person can still get at it, and fresh ones are made beside it.
         */
        private fun setAsideUnrecorded(db: SQLiteDatabase, old: Int) {
            // Index names are global, and this one would stop the new table's
            // index being created. An index holds no data of its own.
            db.execSQL("DROP INDEX IF EXISTS idx_outbox_session")
            val stamp = System.currentTimeMillis()
            KEPT_TABLES.filter { hasTable(db, it) }.forEach { table ->
                db.execSQL("ALTER TABLE $table RENAME TO ${table}_v${old}_$stamp")
            }
        }

        private fun hasTable(db: SQLiteDatabase, table: String): Boolean =
            db.rawQuery(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
                arrayOf(table),
            ).use { it.moveToFirst() }

        private fun hasColumn(db: SQLiteDatabase, table: String, column: String): Boolean =
            db.rawQuery("PRAGMA table_info($table)", null).use { cursor ->
                val name = cursor.getColumnIndex("name")
                var found = false
                while (!found && cursor.moveToNext()) found = cursor.getString(name) == column
                found
            }

        override fun onConfigure(db: SQLiteDatabase) {
            // Write-ahead logging so the two-second spool never blocks a read,
            // and vice versa: the uploader reads the outbox on one thread while
            // the spooler appends to it on another, for the whole of a sweep.
            db.enableWriteAheadLogging()
            db.execSQL("PRAGMA foreign_keys = ON")
        }
    }

    private val db: SQLiteDatabase get() = helper.writableDatabase

    // ---------------------------------------------------------------- catalogue

    /**
     * What this handheld holds, or null when it holds nothing FOR THIS NODE.
     *
     * The node key is half the answer. One build serves a DC and a shop, and
     * which node a device belongs to is a Setelan field somebody can change on
     * the floor. A catalogue that forgot where it came from lets a handheld
     * repointed from `dc-01` to `store-07` answer shop questions out of
     * warehouse data — and look entirely right while doing it.
     */
    fun meta(nodeKey: String): CatalogMeta? =
        db.rawQuery(
            "SELECT node_key,generation,item_count,content_hash,synced_at FROM catalog_meta WHERE singleton=1",
            null,
        ).use { cursor ->
            if (!cursor.moveToFirst()) return null
            val stored = cursor.getString(0)
            if (stored != nodeKey) return null
            CatalogMeta(stored, cursor.getLong(1), cursor.getLong(2), cursor.getString(3), cursor.getString(4))
        }

    /** The generation this handheld is at for [nodeKey]; 0 when it has none. */
    fun generation(nodeKey: String): Long = meta(nodeKey)?.generation ?: 0L

    /**
     * Swap a whole catalogue in, or leave the old one entirely alone.
     *
     * One transaction covers the delete and every insert, for the reason the
     * edge gives for its own chunked apply: a half-applied catalogue names some
     * products and silently omits others, and the omission reads as missing
     * stock rather than as a broken delivery.
     */
    fun replaceAll(
        nodeKey: String,
        generation: Long,
        contentHash: String,
        rows: List<CatalogRow>,
        syncedAt: String,
    ) {
        val database = db
        database.beginTransaction()
        try {
            database.execSQL("DELETE FROM sku_scan_master")
            val insert = database.compileStatement(
                "INSERT INTO sku_scan_master" +
                    " (sku_code,article_code,name,division_code,barcode,base_price_minor,active)" +
                    " VALUES (?,?,?,?,?,?,?)",
            )
            insert.use {
                rows.forEach { row ->
                    it.clearBindings()
                    it.bindString(1, row.skuCode)
                    row.articleCode?.let { v -> it.bindString(2, v) }
                    it.bindString(3, row.name)
                    row.divisionCode?.let { v -> it.bindString(4, v) }
                    row.barcode?.let { v -> it.bindString(5, v) }
                    row.basePriceMinor?.let { v -> it.bindLong(6, v) }
                    it.bindLong(7, if (row.active) 1 else 0)
                    it.executeInsert()
                }
            }
            database.replace(
                "catalog_meta", null,
                ContentValues().apply {
                    put("singleton", 1)
                    put("node_key", nodeKey)
                    put("generation", generation)
                    put("item_count", rows.size.toLong())
                    put("content_hash", contentHash)
                    put("synced_at", syncedAt)
                },
            )
            database.setTransactionSuccessful()
        } finally {
            database.endTransaction()
        }
    }

    /**
     * Every SKU this handheld can name, as one set.
     *
     * This is the only catalogue data that lives in RAM during a sweep, and it
     * is the whole reason an UNKNOWN count can exist offline: a tag decodes to
     * a SKU by arithmetic, and whether that SKU is one we have heard of is a
     * set probe on the worker thread. Three to five thousand eleven-character
     * strings — a few hundred kilobytes, not a product cache.
     */
    fun knownSkuCodes(): HashSet<String> {
        val set = HashSet<String>(8192)
        db.rawQuery("SELECT sku_code FROM sku_scan_master", null).use { cursor ->
            while (cursor.moveToNext()) set.add(cursor.getString(0))
        }
        return set
    }

    fun itemCount(): Long =
        db.rawQuery("SELECT COUNT(*) FROM sku_scan_master", null).use {
            if (it.moveToFirst()) it.getLong(0) else 0L
        }

    /**
     * Name a sweep's SKUs — all of them, in as few queries as it takes.
     *
     * Chunked at 500 because SQLite binds at most 999 variables per statement
     * and a stock count of a real shop brings back more distinct products than
     * that. One query per chunk, never one per tag: twenty thousand units are
     * eight hundred products, and eight hundred products are two queries.
     */
    fun lookup(skuCodes: Collection<String>): Map<String, ScanIdentity> {
        if (skuCodes.isEmpty()) return emptyMap()
        val found = HashMap<String, ScanIdentity>(skuCodes.size)
        skuCodes.chunked(CHUNK).forEach { chunk ->
            val placeholders = chunk.joinToString(",") { "?" }
            db.rawQuery(
                "SELECT sku_code,name,article_code,barcode,base_price_minor,active" +
                    " FROM sku_scan_master WHERE sku_code IN ($placeholders)",
                chunk.toTypedArray(),
            ).use { cursor ->
                while (cursor.moveToNext()) {
                    val identity = cursor.toIdentity()
                    found[identity.skuCode] = identity
                }
            }
        }
        return found
    }

    /**
     * Search the whole catalogue, not just what was swept.
     *
     * The index on name makes a prefix match an index walk; an infix match is a
     * scan, which over a few thousand rows is still faster than the operator
     * can type. Barcode and SKU are matched by prefix against their own indexes.
     */
    fun search(query: String, limit: Int = 50): List<ScanIdentity> {
        val needle = query.trim()
        if (needle.isEmpty()) return emptyList()
        val prefix = "$needle%"
        val infix = "%$needle%"
        val rows = ArrayList<ScanIdentity>(limit)
        db.rawQuery(
            "SELECT sku_code,name,article_code,barcode,base_price_minor,active" +
                " FROM sku_scan_master" +
                " WHERE sku_code LIKE ? OR barcode LIKE ? OR article_code LIKE ? OR name LIKE ?" +
                " ORDER BY CASE WHEN sku_code LIKE ? THEN 0 WHEN name LIKE ? THEN 1 ELSE 2 END," +
                " name LIMIT ?",
            arrayOf(prefix, prefix, prefix, infix, prefix, prefix, limit.toString()),
        ).use { cursor ->
            while (cursor.moveToNext()) rows.add(cursor.toIdentity())
        }
        return rows
    }

    private fun android.database.Cursor.toIdentity(): ScanIdentity {
        val sku = getString(0)
        return ScanIdentity(
            skuCode = sku,
            name = getString(1),
            // Not read from the row: the format IS the answer. A SKU is
            // article(8) + colour(1) + size(2), so the column is a convenience
            // for indexing and these two are arithmetic.
            articleCode = if (isNull(2)) sku.takeIf { it.length >= 8 }?.take(8) else getString(2),
            colour = sku.takeIf { it.length == 11 }?.substring(8, 9),
            size = sku.takeIf { it.length == 11 }?.substring(9, 11),
            barcode = if (isNull(3)) null else getString(3),
            basePriceMinor = if (isNull(4)) null else getLong(4),
            active = getLong(5) == 1L,
        )
    }

    // ----------------------------------------------------------- epc aliases

    /**
     * Marry tags that carry somebody else's EPC to products that exist.
     *
     * # Why a bench needs this
     *
     * A rig is full of tags that are ours in silicon and not in writing:
     * factory EPCs, another system's encoding, leftovers from an old trial.
     * They decode to no SKU, so a sweep reports forty transponders and three
     * products, and the app looks broken while the radio is working perfectly.
     *
     * An alias says "when you see this exact EPC, call it this product". It is
     * a bench fixture and nothing more: it invents no stock, moves no ledger,
     * and never leaves this device. The evidence filed to the Edge still
     * carries the REAL EPC, because what the reader saw is what the reader saw.
     */
    fun marryEpcs(epcs: List<String>, skuCodes: List<String>): Int {
        if (epcs.isEmpty() || skuCodes.isEmpty()) return 0
        val database = db
        database.beginTransaction()
        try {
            val insert = database.compileStatement(
                "INSERT OR REPLACE INTO epc_alias (epc,sku_code) VALUES (?,?)",
            )
            insert.use {
                epcs.forEachIndexed { index, epc ->
                    it.clearBindings()
                    it.bindString(1, epc)
                    // Spread them across the catalogue rather than piling every
                    // tag onto one product: a bench that shows twenty different
                    // garments exercises the grouping, the list and the search.
                    it.bindString(2, skuCodes[index % skuCodes.size])
                    it.executeInsert()
                }
            }
            database.setTransactionSuccessful()
            return epcs.size
        } finally {
            database.endTransaction()
        }
    }

    /** Every marriage, as one map for the scan worker to hold. */
    fun epcAliases(): HashMap<String, String> {
        val map = HashMap<String, String>()
        db.rawQuery("SELECT epc,sku_code FROM epc_alias", null).use { cursor ->
            while (cursor.moveToNext()) map[cursor.getString(0)] = cursor.getString(1)
        }
        return map
    }

    fun aliasCount(): Int =
        db.rawQuery("SELECT COUNT(*) FROM epc_alias", null).use {
            if (it.moveToFirst()) it.getInt(0) else 0
        }

    fun clearAliases() = db.execSQL("DELETE FROM epc_alias")

    /** A page of SKUs to marry tags to. */
    fun someSkuCodes(limit: Int): List<String> {
        val rows = ArrayList<String>(limit)
        db.rawQuery(
            "SELECT sku_code FROM sku_scan_master WHERE active=1 ORDER BY sku_code LIMIT ?",
            arrayOf(limit.toString()),
        ).use { cursor -> while (cursor.moveToNext()) rows.add(cursor.getString(0)) }
        return rows
    }

    // ----------------------------------------------------------------- sweeps

    /**
     * Write a finished sweep down.
     *
     * A count that only ever existed on a screen is a count somebody has to
     * remember, and the first thing an operator asks after walking an aisle is
     * "what did the last one say". The evidence already went to the Edge; this
     * is the operator's own record of their own work, and it stays on the
     * device that did it.
     */
    fun recordSweep(
        endedAt: String,
        mode: String,
        units: Int,
        skus: Int,
        articles: Int,
        unknown: Int,
        foreign: Int,
        lines: List<Pair<String, Int>>,
    ): Long {
        val database = db
        database.beginTransaction()
        try {
            val id = database.insert(
                "sweep", null,
                ContentValues().apply {
                    put("ended_at", endedAt)
                    put("mode", mode)
                    put("units", units)
                    put("skus", skus)
                    put("articles", articles)
                    put("unknown", unknown)
                    put("foreign_tags", foreign)
                },
            )
            val insert = database.compileStatement(
                "INSERT INTO sweep_line (sweep_id,sku_code,qty) VALUES (?,?,?)",
            )
            insert.use {
                lines.forEach { (sku, qty) ->
                    it.clearBindings()
                    it.bindLong(1, id)
                    it.bindString(2, sku)
                    it.bindLong(3, qty.toLong())
                    it.executeInsert()
                }
            }
            database.setTransactionSuccessful()
            return id
        } finally {
            database.endTransaction()
        }
    }

    /** The last sweeps, newest first. */
    fun sweeps(limit: Int = 200): List<SweepRecord> {
        val rows = ArrayList<SweepRecord>()
        db.rawQuery(
            // Pinned first, then newest. A sweep somebody pinned is a sweep
            // they intend to come back to, and burying it under this morning's
            // work is the one thing a pin exists to prevent.
            "SELECT id,ended_at,mode,units,skus,articles,unknown,foreign_tags,pinned" +
                " FROM sweep ORDER BY pinned DESC, id DESC LIMIT ?",
            arrayOf(limit.toString()),
        ).use { cursor ->
            while (cursor.moveToNext()) {
                rows.add(
                    SweepRecord(
                        id = cursor.getLong(0),
                        endedAt = cursor.getString(1),
                        mode = cursor.getString(2),
                        units = cursor.getInt(3),
                        skus = cursor.getInt(4),
                        articles = cursor.getInt(5),
                        unknown = cursor.getInt(6),
                        foreign = cursor.getInt(7),
                        pinned = cursor.getInt(8) == 1,
                    ),
                )
            }
        }
        return rows
    }

    /** Keep a sweep at the top of the history, or let it go back into the flow. */
    fun setPinned(sweepId: Long, pinned: Boolean) {
        db.execSQL(
            "UPDATE sweep SET pinned=?1 WHERE id=?2",
            arrayOf<Any>(if (pinned) 1 else 0, sweepId),
        )
    }

    /** What one recorded sweep found, as products. */
    fun sweepLines(sweepId: Long): List<Pair<String, Int>> {
        val rows = ArrayList<Pair<String, Int>>()
        db.rawQuery(
            "SELECT sku_code,qty FROM sweep_line WHERE sweep_id=? ORDER BY qty DESC",
            arrayOf(sweepId.toString()),
        ).use { cursor ->
            while (cursor.moveToNext()) rows.add(cursor.getString(0) to cursor.getInt(1))
        }
        return rows
    }

    // ------------------------------------------------------------------ outbox

    /**
     * Put a frozen batch somewhere a flat battery cannot reach it.
     *
     * The bytes are stored exactly as they will be sent. They are never rebuilt:
     * `observed_at` lives inside the signed body, so a regenerated batch has a
     * different digest and the edge sees a different request under the same
     * idempotency key — which is a conflict, not a retry.
     *
     * Returns false when this key is already spooled, which is how a retry of
     * the spool step itself stays harmless.
     */
    fun spool(sessionId: String, idempotencyKey: String, body: ByteArray, epcCount: Int, at: String): Boolean {
        val values = ContentValues().apply {
            put("session_id", sessionId)
            put("idempotency_key", idempotencyKey)
            put("body", body)
            put("epc_count", epcCount)
            put("created_at", at)
            put("attempts", 0)
        }
        return db.insertWithOnConflict("evidence_outbox", null, values, SQLiteDatabase.CONFLICT_IGNORE) != -1L
    }

    /**
     * The oldest unsent batches, oldest first — the order they were seen in.
     *
     * Not the ones the node refused for good: see [setAside].
     */
    fun pendingBatches(limit: Int = 8): List<OutboxBatch> {
        val rows = ArrayList<OutboxBatch>(limit)
        db.rawQuery(
            "SELECT id,session_id,idempotency_key,body,epc_count,attempts" +
                " FROM evidence_outbox WHERE refused_status IS NULL ORDER BY id LIMIT ?",
            arrayOf(limit.toString()),
        ).use { cursor ->
            while (cursor.moveToNext()) {
                rows.add(
                    OutboxBatch(
                        id = cursor.getLong(0),
                        sessionId = cursor.getString(1),
                        idempotencyKey = cursor.getString(2),
                        body = cursor.getBlob(3),
                        epcCount = cursor.getInt(4),
                        attempts = cursor.getInt(5),
                    ),
                )
            }
        }
        return rows
    }

    fun pendingCount(): Int =
        db.rawQuery("SELECT COUNT(*) FROM evidence_outbox WHERE refused_status IS NULL", null).use {
            if (it.moveToFirst()) it.getInt(0) else 0
        }

    /** Batches the node refused for good, still held here. See [setAside]. */
    fun refusedCount(): Int =
        db.rawQuery("SELECT COUNT(*) FROM evidence_outbox WHERE refused_status IS NOT NULL", null).use {
            if (it.moveToFirst()) it.getInt(0) else 0
        }

    /**
     * The node refused this batch in a way no retry of the same bytes can
     * change. Keep it — never delete it — but stop offering it.
     *
     * # Why aside, and not retried and not dropped
     *
     * The outbox is sent oldest first, and it used to stop at the first
     * failure. One batch the node will never take — a key it already holds for
     * other content, a body it calls malformed — therefore held back every
     * batch spooled after it, for good: a whole shop's evidence waiting behind
     * one bad row. Dropping that row would be worse, because it is still what
     * the reader saw. So it is marked with the status that refused it, the
     * queue moves past it, and the count of refused batches is shown, so a
     * person can see that something is being held and why.
     */
    fun setAside(batchId: Long, status: Int, error: String) {
        db.execSQL(
            "UPDATE evidence_outbox SET refused_status=?,attempts=attempts+1,last_error=? WHERE id=?",
            arrayOf<Any>(status, error.take(400), batchId),
        )
    }

    /**
     * Offer every set-aside batch again; returns how many.
     *
     * Most of what the node refuses for good is refused because of where the
     * handheld points — the wrong Edge, a pool that Edge does not own — and
     * those are fixed in Setelan, not here. Once they are, the same bytes may
     * well be accepted, so saving Setelan puts them back in the queue. A batch
     * that really is beyond saving is simply refused, and set aside, again.
     */
    fun requeueRefused(): Int =
        db.update(
            "evidence_outbox",
            ContentValues().apply { putNull("refused_status") },
            "refused_status IS NOT NULL",
            null,
        )

    /**
     * The edge has it. Drop the batch and remember its tags as filed.
     *
     * Both halves in one transaction: a batch deleted without its EPCs being
     * recorded would be re-collected and re-sent under a DIFFERENT key — the key
     * is derived from the batch's contents, so a differently-composed retry is
     * not deduplicated by anything.
     */
    fun acknowledge(batchId: Long, sessionId: String, epcs: Collection<String>) {
        val database = db
        database.beginTransaction()
        try {
            database.delete("evidence_outbox", "id=?", arrayOf(batchId.toString()))
            val insert = database.compileStatement(
                "INSERT OR IGNORE INTO filed_epc (session_id,epc) VALUES (?,?)",
            )
            insert.use {
                epcs.forEach { epc ->
                    it.clearBindings()
                    it.bindString(1, sessionId)
                    it.bindString(2, epc)
                    it.executeInsert()
                }
            }
            database.setTransactionSuccessful()
        } finally {
            database.endTransaction()
        }
    }

    fun noteFailure(batchId: Long, error: String) {
        db.execSQL(
            "UPDATE evidence_outbox SET attempts=attempts+1,last_error=? WHERE id=?",
            arrayOf<Any>(error.take(400), batchId),
        )
    }

    /** Which of this session's tags the edge has already taken. */
    fun filedEpcs(sessionId: String): HashSet<String> {
        val set = HashSet<String>()
        db.rawQuery("SELECT epc FROM filed_epc WHERE session_id=?", arrayOf(sessionId)).use { cursor ->
            while (cursor.moveToNext()) set.add(cursor.getString(0))
        }
        return set
    }

    /**
     * Let go of bookkeeping that is safe to lose — and never of evidence.
     *
     * This used to delete outbox batches older than seven days, by the
     * device's own clock. A batch only leaves the outbox when the Edge has
     * taken it ([acknowledge]), so every row that rule deleted was evidence
     * nobody had received: a shop offline for a week, or a clock that jumped,
     * and the count was gone with nothing to say so. Unsent evidence is now
     * kept until it is filed, however long that takes.
     *
     * What goes is the record of tags already filed for sessions with nothing
     * left to send, which only ever repeats what the Edge already holds.
     */
    fun prune() {
        db.execSQL(
            "DELETE FROM filed_epc WHERE session_id NOT IN" +
                " (SELECT DISTINCT session_id FROM evidence_outbox)",
        )
    }

    fun close() = helper.close()

    private companion object {
        const val NAME = "itulah-pindai-catalog.db"

        /** 5: `evidence_outbox.refused_status`, added in place by the helper's `onUpgrade`. */
        const val VERSION = 5

        /** SQLite binds at most 999 variables; leave room and stay well under. */
        const val CHUNK = 500

        /**
         * Every table and index, each made only if it is not there already.
         *
         * An upgrade keeps the evidence and history tables and runs this over
         * them, so a plain CREATE would fail on the first table that survived —
         * and a helper whose upgrade throws is a database that never opens.
         */
        val SCHEMA = listOf(
            """CREATE TABLE IF NOT EXISTS sku_scan_master (
                   sku_code         TEXT PRIMARY KEY NOT NULL,
                   article_code     TEXT,
                   name             TEXT NOT NULL,
                   division_code    TEXT,
                   barcode          TEXT,
                   base_price_minor INTEGER,
                   active           INTEGER NOT NULL
               )""",
            "CREATE INDEX IF NOT EXISTS idx_scan_master_article ON sku_scan_master(article_code)",
            "CREATE INDEX IF NOT EXISTS idx_scan_master_barcode ON sku_scan_master(barcode)",
            "CREATE INDEX IF NOT EXISTS idx_scan_master_name ON sku_scan_master(name)",
            """CREATE TABLE IF NOT EXISTS catalog_meta (
                   singleton    INTEGER PRIMARY KEY CHECK (singleton = 1),
                   node_key     TEXT NOT NULL,
                   generation   INTEGER NOT NULL,
                   item_count   INTEGER NOT NULL,
                   content_hash TEXT NOT NULL,
                   synced_at    TEXT NOT NULL
               )""",
            """CREATE TABLE IF NOT EXISTS evidence_outbox (
                   id              INTEGER PRIMARY KEY AUTOINCREMENT,
                   session_id      TEXT NOT NULL,
                   idempotency_key TEXT NOT NULL UNIQUE,
                   body            BLOB NOT NULL,
                   epc_count       INTEGER NOT NULL,
                   created_at      TEXT NOT NULL,
                   attempts        INTEGER NOT NULL DEFAULT 0,
                   last_error      TEXT,
                   refused_status  INTEGER
               )""",
            "CREATE INDEX IF NOT EXISTS idx_outbox_session ON evidence_outbox(session_id)",
            """CREATE TABLE IF NOT EXISTS sweep (
                   id           INTEGER PRIMARY KEY AUTOINCREMENT,
                   ended_at     TEXT NOT NULL,
                   mode         TEXT NOT NULL,
                   units        INTEGER NOT NULL,
                   skus         INTEGER NOT NULL,
                   articles     INTEGER NOT NULL,
                   unknown      INTEGER NOT NULL,
                   foreign_tags INTEGER NOT NULL,
                   pinned       INTEGER NOT NULL DEFAULT 0
               )""",
            """CREATE TABLE IF NOT EXISTS sweep_line (
                   sweep_id INTEGER NOT NULL,
                   sku_code TEXT NOT NULL,
                   qty      INTEGER NOT NULL,
                   PRIMARY KEY (sweep_id, sku_code)
               )""",
            """CREATE TABLE IF NOT EXISTS epc_alias (
                   epc      TEXT PRIMARY KEY NOT NULL,
                   sku_code TEXT NOT NULL
               )""",
            """CREATE TABLE IF NOT EXISTS filed_epc (
                   session_id TEXT NOT NULL,
                   epc        TEXT NOT NULL,
                   PRIMARY KEY (session_id, epc)
               )""",
        )

        /**
         * What an upgrade may drop: the catalogue, a copy of the centre's that
         * the generation gate pulls again. Nothing a person did on this device
         * is in here, and nothing ever should be.
         */
        val CACHE_DROPS = listOf(
            "DROP TABLE IF EXISTS sku_scan_master",
            "DROP TABLE IF EXISTS catalog_meta",
        )

        /**
         * What an upgrade keeps: evidence not yet filed, the record of what was,
         * the operator's history, and a bench's marriages.
         */
        val KEPT_TABLES = listOf("evidence_outbox", "filed_epc", "sweep", "sweep_line", "epc_alias")
    }
}
