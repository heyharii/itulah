# Pakai e2e untuk hub, tunda kasir Tauri dan tablet

**Kesimpulan: pakai, tapi sebagai pilot lokal dua minggu untuk layar web saja (hub Central, store app, dan kasir web edition). Jangan jadikan pengganti `po-flow`, dan jangan pakai dulu untuk kasir Tauri atau tablet.** e2e dari TesterArmy adalah test runner TypeScript open-source (Apache-2.0) yang dibangun di atas Playwright. Satu tes bisa memakai locator deterministik dan langkah agent (`agent.act`, `assert`, `waitFor`, `extract`) sekaligus. Langkah `act` yang sudah terverifikasi direkam ke replay cache, lalu diputar ulang di run berikutnya tanpa memanggil model. Judgment (`assert` dan teman-temannya) selalu jalan live ([Core concepts](https://e2e.tester.army/docs/core-concepts); [Caching](https://e2e.tester.army/docs/cache)). Ini pas dengan cara kita menguji sekarang: agent membuka hub lalu mencoba alur, seperti pass 1–2 Oktober. Bedanya, sekarang semua itu manual, tidak bisa diulang, dan repo belum punya test runner frontend sama sekali ([E2E-TEST-REPORT-2026-10-02.md](/Users/hari/Documents/itulah/E2E-TEST-REPORT-2026-10-02.md)). Risikonya nyata, dan bisa dikelola kalau scope-nya kecil:

- **Masih sangat muda.** Proyek ini baru publik 1 Oktober 2026 dan sekarang di versi 0.18.0.
- **Tidak stabil.** Ada enam rilis stabil dalam tujuh hari, dan 0.17 membawa breaking change.
- **Bergantung pada satu orang.** Sekitar 77% commit dari satu orang ([npm](https://registry.npmjs.org/e2e); [Release 0.17.0](https://github.com/tester-army/e2e/releases/tag/e2e%400.17.0)).
- **Tidak ada engine untuk Tauri atau desktop.**
- **Di Windows harus lewat WSL.**
- **Telemetry nyala secara default.**

Titik mulainya sudah ada: paket `e2e/agentic/` dengan `e2e` 0.18.0 dan `@e2e-dev/web` 0.13.0 yang dipin, plus script yang mematikan telemetry ([package.json](/Users/hari/Documents/itulah/e2e/agentic/package.json)). Langkah berikutnya: siapkan rig terpisah dari `pos-e2e`, lalu tulis tiga tes. Pertama, buat PO di ukuran desk dan phone. Kedua, regresi untuk bug kritis "PO yang dibatalkan masih bisa di-receive". Ketiga, penjualan tunai di kasir web. Ukur replay, biaya, dan false pass dulu, baru putuskan soal commit cache, port `pos-flow`, atau CI.

## Tiga jenis langkah, dan hanya dua yang memanggil model

Sebuah tes e2e terdiri dari tiga jenis langkah, dan bedanya ada di siapa yang menentukan hasil ([Core concepts](https://e2e.tester.army/docs/core-concepts)):

| Langkah | API | Panggil model? | Dipakai untuk |
|---|---|---|---|
| Goal | `agent.act` | Ya, kecuali diputar ulang dari cache | Satu tujuan; agent memilih klik/ketik sendiri |
| Judgment | `agent.assert`, `agent.waitFor`, `agent.extract` | Selalu | Cek makna layar, tunggu kondisi, baca data terstruktur |
| Locator | `screen.*` dan `expect` | Tidak | Kontrol yang sudah diketahui, nilai yang pasti |

**Yang dikirim ke model adalah teks, bukan HTML.** Untuk `act`, prompt pembuka berisi:

- instruksi;
- `params`;
- langkah yang sudah selesai;
- snapshot teks dari accessibility tree yang sudah diredaksi: role, name, text, state, test id, dan target link.

HTML mentah, cookie, header, dan nilai environment tidak ikut. Field password dimask, dan nilai secret yang kebetulan tampil di layar diganti `<secret:name>`. Setelah tiap aksi, model hanya menerima perubahan layar. Model baru menerima snapshot penuh lagi kalau sebagian besar layar berubah ([How agent steps work](https://e2e.tester.army/docs/agent-steps); [Security model](https://e2e.tester.army/docs/security)). Judgment sengaja dibuat "buta konteks". `assert`, `waitFor`, dan `extract` hanya melihat pernyataan dan layar saat itu. Mereka tidak melihat langkah sebelumnya atau ringkasan yang ditulis agent saat `act` ([Core concepts](https://e2e.tester.army/docs/core-concepts)). Jadi agent yang barusan mengklik tidak menilai pekerjaannya sendiri. Screenshot hanya diminta kalau snapshot teks tidak cukup, atau kalau kita pasang `vision: true` / `'only'`. Ukurannya maksimal 768 px di sisi panjang, dan hanya dua screenshot terbaru yang disimpan ([agent](https://e2e.tester.army/docs/reference/agent)).

**Agent hanya boleh memakai tool tertutup yang disediakan engine.** Daftarnya: `tap`, `double_tap`, `long_press`, `right_click`, `hover`, `type`, `press`, `select`, `check`, `scroll`, `scroll_to`, `drag`, `upload`, `navigate`, `back`, `observe`, plus `type_secret` kalau langkah itu mendeklarasikan secret. Pixel tool seperti `tap_at` hanya tersedia selama belum ada secret yang diisi. Pindah tab belum punya verb, jadi tab baru tidak terlihat oleh model ([agent](https://e2e.tester.army/docs/reference/agent)).

Loop agent mendeteksi pengulangan. Setelah tiga aksi gagal berturut-turut, model diminta ganti pendekatan. Setelah lima, model diminta memberi verdict ([How agent steps work](https://e2e.tester.army/docs/agent-steps)). Tiap langkah punya budget keras:

| Method | Model calls | Aksi | Timeout default |
|---|---|---|---|
| `act` | 25 | 25 | 120 s (`config.timeout`) |
| `waitFor` | 25 | 0 | 30 s (`judgmentTimeout`) |
| `assert`, `extract` | 2 (1 + 1 repair) | 0 | 30 s |

Satu aksi yang menargetkan elemen dibatasi maksimal 15 detik. Budget per panggilan hanya boleh diturunkan, tidak bisa dinaikkan ([agent](https://e2e.tester.army/docs/reference/agent)).

**Hasil langkah ada tiga: `passed`, `failed`, atau `blocked`. Pemisahan ini berguna untuk triage.** Bug produk masuk `failed` (exit 1). Masalah lingkungan masuk `blocked`, dengan exit code berbeda: credential ditolak atau seed data hilang keluar dengan exit 2, environment mati dengan exit 3 ([How agent steps work](https://e2e.tester.army/docs/agent-steps)). Semua kegagalan agent muncul sebagai `AgentError { code, explanation, blocked }` dan dikenali lewat `isAgentError()` ([agent](https://e2e.tester.army/docs/reference/agent)). `extract` memvalidasi output dengan Standard Schema (Zod, Valibot, ArkType). Kalau datanya tidak ada di layar, hasilnya `ASSERTION_INCONCLUSIVE`, bukan placeholder karangan ([agent](https://e2e.tester.army/docs/reference/agent)). Secret tidak pernah sampai ke model. Model hanya tahu nama dan tujuannya. Runner memeriksa field yang dipilih model (harus input aktif, dan password hanya boleh masuk field password), lalu runner sendiri yang mengisi nilainya ([How agent steps work](https://e2e.tester.army/docs/agent-steps)).

## Replay cache menggratiskan `act`, bukan `assert`

**Cache hanya merekam `act` yang dikonfirmasi oleh pengecekan berikutnya.** Pengecekan yang dihitung:

- locator matcher seperti `toHaveText`, `toBeVisible`, atau `toBeHidden`;
- `expect(browser).toHaveURL`;
- `agent.assert` atau `agent.waitFor`.

Yang tidak dihitung: `expect(value).toBe` pada nilai biasa, `expect.poll`, `agent.extract`, `act` berikutnya, dan attempt yang sekadar lulus. Langkah yang tidak dikonfirmasi tercatat `unconfirmed` dan tidak disimpan ([Caching](https://e2e.tester.army/docs/cache)). Aturan ini juga tertulis di skill coding agent: satu `act` per goal, lalu satu `expect` ([Coding agents](https://e2e.tester.army/docs/coding-agents)). Replay berjalan dalam empat tahap:

1. Mengecek bahwa layar awal ada di route yang sama.
2. Mencari tiap kontrol yang direkam berdasarkan role, name, test id, dan konteks sekitarnya, lalu mengulang aksinya.
3. Mengecek route akhir dan kontrol yang muncul atau hilang.
4. Selesai tanpa model, atau menyerahkan sisa langkah ke agent kalau ada yang tidak cocok.

Ringkasan run memisahkan hasilnya menjadi `replayed`, `handed off`, dan `missed`, lengkap dengan alasannya ([Caching](https://e2e.tester.army/docs/cache)).

**Entry cache terikat pada test, target, instruksi, params, dan agent, tapi tidak pada model.** Mengganti model tidak membuat cache miss. Issue #1000 menunjuk efeknya: model bisa ditukar diam-diam, dan report mencatat lulusnya tes untuk model yang sebenarnya tidak pernah jalan ([Caching](https://e2e.tester.army/docs/cache); [Issue #1000](https://github.com/tester-army/e2e/issues/1000)).

Nilai yang berubah tiap run, seperti tag `UJI-…` atau nomor PO baru, akan membuat miss di setiap run kecuali dibungkus `unique()`. Dengan `unique()`, runner mengganti nilai lama dengan nilai baru saat replay. Ada jebakan halus di sini: kalau nilai `unique()` sama dengan, atau termuat di dalam, nilai param lain, langkahnya tetap lulus tapi tidak direkam (`param-collision`) ([Caching](https://e2e.tester.army/docs/cache)). Contohnya supplier `QA UJI-x` dan catatan `UJI-x` di langkah yang sama. Ada juga "gap" yang tidak bisa direplay:

- `whole-node`: seluruh nama atau teks sebuah kontrol yang dibaca dari layar;
- `minted-token`: kode atau id yang dicetak aplikasi sendiri, misalnya nomor PO baru;
- `date`: nilai yang dihitung dari tanggal;
- `pixels`: nilai yang diketik setelah melihat screenshot;
- project tool yang mengubah data.

Langkah dengan gap tetap jalan live di bagian itu. Rekaman juga terpotong (`truncated`) kalau langkahnya lebih dari 50 aksi atau mengetik nilai lebih dari 4.096 karakter ([Caching](https://e2e.tester.army/docs/cache)).

**Secara default, cache stale tidak bersuara.** `e2e init` memasukkan `.e2e/cache/` ke `.gitignore`, dan CI default-nya `read-only`. Jadi CI mulai tanpa rekaman sampai direktori itu di-commit. Kalau rekaman yang sudah di-commit berhenti cocok, agent mengambil alih, tes tetap lulus, dan setiap run CI membayar model sampai ada yang merekam ulang. `--strict-cache` membalik perilaku ini: langkah yang rekamannya ada tapi tidak bisa direplay langsung gagal dengan `REPLAY_STALE` tanpa memanggil model. Run strict juga tidak menulis atau menghapus entry, jadi dokumentasi menyarankan flag ini di CI, bukan `cache.strict` di config ([Caching](https://e2e.tester.army/docs/cache)). Upgrade e2e yang mengubah cara entry dicocokkan akan me-rekey semua entry. Rilis 0.17.0 melakukan persis itu ([Release 0.17.0](https://github.com/tester-army/e2e/releases/tag/e2e%400.17.0)). Entry tidak berisi prompt, screenshot, tree, atau nilai secret. Tapi nilai lain yang diketik disimpan apa adanya, sehingga entry harus direview seperti kode sebelum di-commit ([Caching](https://e2e.tester.army/docs/cache)).

**Angka biayanya menjelaskan kenapa komunitas menyarankan agar AI mengklik tapi tidak menilai.** Dokumentasi memberi contoh biaya langkah:

- satu `act`: 3 call, $0.0198;
- satu `assert`: 1 call, $0.0114.

Keduanya diukur dengan `anthropic/claude-sonnet-4.5` ([Debugging a run](https://e2e.tester.army/docs/debugging)). Satu evaluasi komunitas memakai Claude Sonnet 5.5 pada 68 skenario dengan 166 langkah AI: 67 act, 95 assert, 2 waitFor, dan 2 extract.

| Mode | Lulus | Waktu | Model calls | Biaya |
|---|---|---|---|---|
| Live | 68/68 | 199,6 s | 249 | $1,99 |
| Replay | 68/68 | 182,0 s | 126 | $1,03 |

Artinya replay hanya memangkas biaya sekitar 48% dan waktu sekitar 9%, karena suite itu didominasi assert. Rata-rata biaya per langkah: act $0,0189, assert $0,0073, waitFor $0,0072, extract $0,0093. Sampelnya kecil dan tidak jalan di CI ([tests-e2e FOUR_OPERATIONS.md](https://github.com/slawekradzyminski/tests-e2e/blob/main/evaluation/FOUR_OPERATIONS.md)). Tulisan DEV yang paling sering dirujuk merumuskannya sebagai "Let the AI click, don't let it grade". Biarkan `act` membawa tes ke layar yang tepat. Nilai hasilnya dengan `expect` yang pasti. Pakai `assert` hanya kalau jawabannya memang soal makna ([DEV, ianwieds](https://dev.to/ianwieds/let-the-ai-click-dont-let-it-grade-3abo)). Issue #963 mengusulkan cache untuk judgment juga, tapi sampai 9 Oktober statusnya masih proposal ([Issue #963](https://github.com/tester-army/e2e/issues/963)).

## Model bebas dipilih, tapi navigasi tanpa allowlist dan telemetry nyala

### Model dan subscription

**e2e tidak punya model default. Semua provider AI SDK yang mendukung tool call bisa dipakai, dan built-in agent butuh model yang juga menerima gambar.** Ada empat jalur yang didokumentasikan:

- Vercel AI Gateway (`gateway()`, `AI_GATEWAY_API_KEY`);
- OpenRouter (`@openrouter/ai-sdk-provider`, `OPENROUTER_API_KEY`);
- paket provider langsung, misalnya `@ai-sdk/anthropic`;
- endpoint OpenAI-compatible lokal (`createOpenAICompatible({ baseURL: 'http://127.0.0.1:11434/v1' })`).

e2e tidak memuat `.env` sendiri, jadi variabel harus di-export atau dimuat dengan `process.loadEnvFile()` ([Models](https://e2e.tester.army/docs/models)). Model diatur per agent bernama di `agents.<name>`. Ada `judge` terpisah untuk `assert`, `waitFor`, dan `extract`. Agent tidak mewarisi model satu sama lain. Agent juga punya `context` (maksimal 16 KB) yang ikut di setiap panggilan ([Models](https://e2e.tester.army/docs/models); [config](https://e2e.tester.army/docs/reference/config)). Untuk menekan biaya ada jalur "decision model" (Clef, Jev) lewat custom executor ([Models](https://e2e.tester.army/docs/models)). Tapi issue terbuka menunjukkan executor itu belum matang: state `selected` tidak sampai ke model sehingga langkah tab jadi untung-untungan, dan navigasi "Back" tidak pernah dikonfirmasi ([Issue #884](https://github.com/tester-army/e2e/issues/884); [Issue #885](https://github.com/tester-army/e2e/issues/885)).

Subscription yang sudah dibayar juga bisa dipakai untuk langkah agent ([Subscriptions](https://e2e.tester.army/docs/subscriptions)):

| Plan | Cara connect |
|---|---|
| ChatGPT Plus/Pro | `npx e2e login openai` |
| GitHub Copilot | `npx e2e login github-copilot` |
| OpenCode Console | `npx e2e login opencode-console` |
| SuperGrok / X Premium+ | `npx e2e login spacexai` |
| Claude Max/Team | API key dari kredit API bulanan plan (`ANTHROPIC_API_KEY`) |

Di CI tetap pakai API key, karena token login yang dirotasi hanya bertahan sebentar ([Subscriptions](https://e2e.tester.army/docs/subscriptions)).

Soal retensi data, dokumentasi mencatat beberapa hal:

- request ke model Responses OpenAI selalu membawa `store: false`;
- Anthropic di bawah BAA harus dipanggil langsung lewat `@ai-sdk/anthropic`, tidak lewat gateway atau OpenRouter;
- setiap request membawa `User-Agent: e2e/<versi>`, `HTTP-Referer: https://tester.army/e2e`, dan `X-Title: e2e`, yang menimpa header sama yang kita set sendiri ([Models](https://e2e.tester.army/docs/models)).

### Batas keamanan

**Batas keamanannya jelas, tapi ada lubang yang harus kita jaga sendiri.**

- **Kode tes tidak di-sandbox.** Kode tes, config, engine, dan reporter jalan dengan permission OS kita ([Security model](https://e2e.tester.army/docs/security)).
- **Konten aplikasi diperlakukan sebagai data.** Model menerimanya sebagai bukti yang tidak dipercaya, dan konten aplikasi tidak bisa memberi model tool, credential, atau budget lebih ([Security model](https://e2e.tester.army/docs/security)).
- **Panggilan tool yang melanggar aturan ditolak dengan `POLICY_DENIED`.** Contohnya navigasi ke skema selain http(s) atau `about:blank`, membaca isi field secure, dan password ke field non-password ([Security model](https://e2e.tester.army/docs/security)).
- **Navigasi dan secret fill tidak punya origin allowlist.** Agent bisa mengikuti aplikasi ke situs lain dan memakai secret milik langkah itu di sana ([Security model](https://e2e.tester.army/docs/security)).
- **`basicAuth` menjawab challenge 401 dari origin mana pun.** ([Security model](https://e2e.tester.army/docs/security))
- **Pixel dimatikan setelah secret fill.** Untuk sisa attempt itu, termasuk di tes yang me-restore session hasil setup yang mengisi password, screenshot, `vision`, dan `toHaveScreenshot` mati. Jalan keluar resminya: setup yang login tanpa mengisi secret, misalnya dengan menyuntik cookie session lewat `browser.setCookies`, membiarkan screenshot tetap tersedia ([Security model](https://e2e.tester.army/docs/security)).
- **Session per run.** Session dienkripsi AES-256-GCM dengan key yang hanya ada di memori run, berlaku maksimal 24 jam, dan dihapus di akhir run ([Security model](https://e2e.tester.army/docs/security)).
- **Video tidak dimask sama sekali.** ([Security model](https://e2e.tester.army/docs/security))
- **`command.log` tidak diredaksi.** ([Security model](https://e2e.tester.army/docs/security))
- **Entry cache tidak ditandatangani,** tapi divalidasi sebelum dipakai ([Security model](https://e2e.tester.army/docs/security)).
- **`e2e explore` menawarkan semua credential yang dikonfigurasi ke setiap langkah.** ([Security model](https://e2e.tester.army/docs/security))

### Telemetry

**Telemetry aktif secara default dan dikirim ke PostHog EU (`eu.i.posthog.com`).** Isinya:

- jumlah tes dan jumlah langkah per jenis;
- nama flag, tanpa nilainya;
- error code;
- `model_id`, jumlah token, dan estimasi biaya;
- coding agent yang menjalankan CLI;
- hash dari root commit repo sebagai `project_id`;
- kelas mesin.

Yang tidak pernah dikirim: judul tes, URL, instruksi, isi halaman, screenshot, dan credential ([Telemetry](https://e2e.tester.army/docs/telemetry)). Opt-out bisa lewat `E2E_TELEMETRY_DISABLED=1`, `DO_NOT_TRACK=1`, atau `npx e2e telemetry disable`. `E2E_TELEMETRY_DEBUG=1` mencetak payload tanpa mengirimnya ([Telemetry](https://e2e.tester.army/docs/telemetry)).

## API ala Playwright, plus MCP dan explore untuk coding agent

**Bentuk API-nya akan terasa familiar bagi siapa pun yang pernah memakai Playwright atau Testing Library.**

- **Struktur tes.** `test`, `describe`, empat hook, `test.extend` untuk fixture, dan `test.only/skip`. Ada dua ide khas e2e. Pertama, `test.setup(..., { sessions: [...] })` yang menyimpan session bernama terenkripsi, lalu dipakai tes lain lewat `{ session }`. Kedua, opsi per tes `agent`, `agentContext`, `platforms`, `requires`, dan `serial` ([test](https://e2e.tester.army/docs/reference/test)).
- **Paralelisme.** Paralel hanya antar file: tes dalam satu file jalan berurutan di satu worker. `--shard i/n` tersedia ([test](https://e2e.tester.army/docs/reference/test); [CLI](https://e2e.tester.army/docs/reference/cli)).
- **Query.** `getByRole`, `getByLabel`, `getByPlaceholder`, `getByText`, `getByDisplayValue`, dan `getByTestId`. Defaultnya exact dan case-sensitive. Locator ketat: kalau cocok lebih dari satu elemen, langsung `LOCATOR_AMBIGUOUS`, bukan klik yang pertama ([screen](https://e2e.tester.army/docs/reference/screen)).
- **Aksi.** Auto-wait 30 detik ([screen](https://e2e.tester.army/docs/reference/screen)).
- **Matcher.** Locator matcher retry selama 5 detik. Value matcher bergaya Jest, ditambah `toMatchSchema`, `expect.soft`, `expect.poll`, dan `toHaveScreenshot` ([expect](https://e2e.tester.army/docs/reference/expect)).
- **Fixture.** `app` portabel: `open`, `restart`, `clearState`, `back`, `screenshot`, `baseUrl`. Hal spesifik platform ada di `browser` (route, cookie, dialog, download, iframe) atau `device` ([app](https://e2e.tester.army/docs/reference/app); [web](https://e2e.tester.army/docs/reference/web)).
- **Config.** `e2e.config.ts` divalidasi ketat: key yang tidak dikenal ditolak dengan saran nama terdekat. Key utamanya `targets`, `agents`, `credentials`, `secrets`, `cache`, `tests`, dan timeout-timeout ([config](https://e2e.tester.army/docs/reference/config)).
- **CLI.** `init`, `login`, `models`, `guide`, `mcp`, `run`, `explore`, `list`, `cache`, `feedback`, dan `telemetry` ([CLI](https://e2e.tester.army/docs/reference/cli)).
- **Exit code berbasis kelas.** 0 lulus; 1 tes gagal; 2 config, credential, atau policy; 3 infrastruktur; 130 interrupt ([CLI](https://e2e.tester.army/docs/reference/cli)).
- **Reporter.** Built-in-nya `list`, `json` (skema `report-1`), `junit`, dan `markdown`. Antarmuka `Reporter` custom tersedia. Belum ada HTML reporter; setiap tes gagal mendapat halaman `trace.md` ([reporters](https://e2e.tester.army/docs/reference/reporters); [From Playwright](https://e2e.tester.army/docs/migrate/playwright)).

**Coding agent adalah warga kelas satu.** `e2e init` memasang skill di `.agents/skills/e2e/` (symlink-nya di `.claude/skills/e2e/` untuk Claude Code) dan mendaftarkan MCP server di `.mcp.json` ([Coding agents](https://e2e.tester.army/docs/coding-agents)). Skill tambahan `create-verification-skill` membuat skill `verify-<app>` per proyek: cara menyalakan app, peta fitur, dan satu charter explore per fitur ([Coding agents](https://e2e.tester.army/docs/coding-agents)).

`e2e mcp` adalah server stdio yang tidak butuh model. Isinya empat tool MCP: `open_session`, `tools`, `call`, dan `close_session`. Lewat `call`, agent mendapat katalog tool aplikasi: `observe`, semua verb aksi, `screenshot`, dan `locate`. `locate` mengembalikan kode `screen.*` yang siap ditempel kalau tepat satu elemen cocok. Default-nya 4 session paralel (bisa 1–16). Session ditutup setelah 30 menit idle. Apa pun yang dilakukan session tidak masuk replay cache ([MCP server](https://e2e.tester.army/docs/reference/mcp)). Alur yang dimaksud: coding agent menjelajah lewat MCP, lalu menulis `*.e2e.ts` yang deterministik.

**`e2e explore` dan bug bash membuka mode tanpa file tes.** `explore` diberi satu goal, merencanakan langkahnya sendiri, dan melaporkan finding. `issue` membuat run gagal dengan exit 1; `warning` tidak. Severity-nya 1 sampai 5 ([Exploring without a test](https://e2e.tester.army/docs/explore); [CLI](https://e2e.tester.army/docs/reference/cli)).

| Batas explore | Default | Maksimum |
|---|---|---|
| Langkah | 8 | 12 |
| Waktu | 10 menit | 15 menit |
| Per langkah | 40 aksi, 40 model call | – |

Cache tidak dipakai di explore. `--session` memulai explore dalam keadaan sudah login ([Exploring without a test](https://e2e.tester.army/docs/explore); [CLI](https://e2e.tester.army/docs/reference/cli)).

Bug bash adalah prosedur di dalam skill:

1. Coding agent membaca route dan diff branch.
2. Agent menulis 5–10 charter.
3. Agent menjalankan `explore` empat sekaligus.
4. Finding yang penyebabnya sudah diketahui dibuang: batas explorer, environment, desain, atau seed.
5. Agent menulis repro test untuk sisanya.
6. Sebuah finding baru dihitung bug kalau repro test-nya gagal dengan `ASSERTION_FAILED`.

Repro test diberi tag `bugbash` dan dikeluarkan dari run yang menggerbangi merge. Video explorer tidak dimask, jadi cek dulu sebelum dibagikan ([Bug bashes](https://e2e.tester.army/docs/bug-bash)).

## Web siap, mobile lewat agent-device, desktop belum ada

### Web engine

**`@e2e-dev/web` menjalankan Chromium, Firefox, dan WebKit di atas `playwright-core` yang versinya dipin persis.** Tes jalan sekali per target. Target dengan `app.command` sama berbagi satu proses ([Web](https://e2e.tester.army/docs/web)). Runner bisa menyalakan dev server sendiri (`app.command`, mirip `webServer` di Playwright) dan memakai server yang sudah jalan lewat `reuseExisting`, tapi CI mengabaikan opsi itu ([Web](https://e2e.tester.army/docs/web)). Batas-batas yang relevan:

- **Hanya proses aplikasi yang dinyalakan runner.** Database dan proses lain tidak ikut dinyalakan; services API baru dijanjikan di rilis berikutnya ([Web](https://e2e.tester.army/docs/web)).
- **Viewport hanya mengatur ukuran.** Tidak ada `isMobile`, `hasTouch`, device preset, `colorScheme`, `geolocation`, atau `offline` ([From Playwright](https://e2e.tester.army/docs/migrate/playwright)).
- **`platforms` dan `requires` tidak bisa memilih viewport,** karena semua target Playwright berplatform `web` ([Web](https://e2e.tester.army/docs/web)).
- **Popup dan `window.open` tidak diikuti.** ([Browser reference](https://e2e.tester.army/docs/reference/web))
- **Butuh Node 24.8 ke atas, dan di Windows harus di dalam WSL.** ([Quickstart](https://e2e.tester.army/docs/quickstart))

API test bisa ditulis dengan `fetch` biasa plus `toMatchSchema`, dalam file dan run yang sama dengan tes UI ([API](https://e2e.tester.army/docs/api-testing)). Visual regression memakai `toHaveScreenshot`, dengan baseline per target dan OS ([Visual comparison](https://e2e.tester.army/docs/visual-testing)).

### Mobile engine

**`@e2e-dev/mobile` membungkus agent-device dari Callstack.** Engine ini menggerakkan simulator iOS, emulator Android, dan HP yang terhubung lewat USB melalui accessibility tree ([Mobile](https://e2e.tester.army/docs/mobile)). Yang perlu diketahui:

- **Build disediakan sendiri.** Engine tidak menginstal apa pun; kita memberi build `.app` atau `.apk` ([Mobile](https://e2e.tester.army/docs/mobile)).
- **Test id di Compose perlu satu setting.** Untuk Jetpack Compose, `getByTestId` butuh `Modifier.testTag()` ditambah `testTagsAsResourceId = true` ([Mobile](https://e2e.tester.army/docs/mobile)).
- **Tidak ada session di device.** `test.setup` dan session tidak tersedia, jadi tiap tes harus login sendiri atau memakai data seed ([Mobile](https://e2e.tester.army/docs/mobile)).
- **HP dipanggil dengan nama.** Serial adb tidak dianggap id ([Mobile](https://e2e.tester.army/docs/mobile)).
- **Engine-nya sendiri masih pre-1.0.** agent-device ada di v0.21.22 ([agent-device](https://github.com/callstack/agent-device)).
- **Bug Android masih terbuka:**
  - tap locator di Android mengenai kontrol lain ([#797](https://github.com/tester-army/e2e/issues/797));
  - membaca layar yang terus berubah makan 20–40 detik per read ([#841](https://github.com/tester-army/e2e/issues/841)).

### Desktop

**Tidak ada engine untuk desktop.** Pencarian di seluruh docs untuk Electron, Tauri, dan WebView tidak menemukan apa pun. Desktop hanya disebut sebagai contoh platform yang bisa ditulis sendiri lewat kontrak `defineEngine` ([Writing an engine](https://e2e.tester.army/docs/writing-an-engine)). Permintaan dukungan macOS desktop masih berupa issue terbuka ([#986](https://github.com/tester-army/e2e/issues/986)).

Secara teori, `web({ connect: { cdpEndpoint } })` bisa menempel ke WebView2 di Windows, karena Playwright sendiri mendokumentasikan `connectOverCDP` ke WebView2 ([Playwright WebView2](https://playwright.dev/docs/webview2)). Tapi ada tiga hambatan. Mode default e2e membuat context baru per attempt, padahal resep Playwright memakai context pertama milik aplikasi. Mode persisten e2e butuh browser yang baru diluncurkan untuk setiap attempt ([Browser reference](https://e2e.tester.army/docs/reference/web)). Runner-nya juga harus jalan di WSL. Kesimpulan ini inferensi dari catatan riset, dan belum ada yang mengujinya.

### CI dan layanan hosted

**CI apa pun yang bisa menjalankan Node bisa dipakai.** Mode CI menyala lewat variabel `CI` dan mengubah beberapa default:

| Setting | Lokal | CI |
|---|---|---|
| `retries` | 0 | 1 |
| `workers` | separuh core | 1 |
| `cache` (kalau tidak diset) | `read-write` | `read-only` |
| `.only` | boleh | `ONLY_IN_CI` |
| `reuseExisting` | dipakai | diabaikan |

Sumber: [CI](https://e2e.tester.army/docs/ci). Ada workflow siap pakai untuk GitHub Actions (web, iOS di `macos-26`, Android dengan KVM), EAS Workflows, Bitrise, dan Codemagic ([GitHub Actions](https://e2e.tester.army/docs/ci/github-actions); [EAS Workflows](https://e2e.tester.army/docs/ci/eas-workflows); [Bitrise](https://e2e.tester.army/docs/ci/bitrise); [Codemagic](https://e2e.tester.army/docs/ci/codemagic)). Reporter `@e2e-dev/github` memasang satu komentar PR per run. Komentarnya berisi hitungan tes, penggunaan agent (misalnya "9 agent steps · 4 replayed · 31 model calls · $0.31"), dan link bukti ([Pull request comments](https://e2e.tester.army/docs/github)). Report dari beberapa shard belum bisa digabung ([CI](https://e2e.tester.army/docs/ci)).

Ada tiga provider hosted resmi:

| Provider | Paket | Isi |
|---|---|---|
| Kernel | `@e2e-dev/kernel` | Chromium hosted |
| EAS Simulators | `@e2e-dev/eas` | Simulator dan emulator hosted, masih limited access |
| smol | `@e2e-dev/smol` | Chromium di microVM lokal dengan cabang copy-on-write per attempt |

Paket smol masih versi 0.0.0 di repo dan belum ada di npm ([Kernel](https://e2e.tester.army/docs/integrations/kernel); [EAS](https://e2e.tester.army/docs/integrations/eas); [smol](https://e2e.tester.army/docs/integrations/smol); [repo packages](https://github.com/tester-army/e2e/tree/main/packages)).

## Baru 10 minggu, 8,3 ribu bintang, 77% commit dari satu orang

### Kematangan

**Momentum e2e besar, tapi umurnya sangat muda.** Lini waktunya:

- 22 Juli 2026: repo `tester-army/e2e` dibuat.
- 14 September: canary pertama di npm.
- 30 September: rilis stabil pertama, 0.15.0.
- 1 Oktober: peluncuran publik.
- 9 Oktober: 8.318 bintang dan 396 fork ([GitHub API](https://api.github.com/repos/tester-army/e2e); [npm](https://registry.npmjs.org/e2e); [Introducing e2e](https://tester.army/blog/introducing-e2e)).

Antara 2 dan 5 Oktober, repo ini sempat di posisi #1–#2 GitHub Trending ([Trendshift](https://trendshift.io/repositories/274762); [AIcoder](https://aicoder.com/news/news-20261005-testerarmy-e2e-ai-testing-framework)). Inti paketnya bergerak dari 0.15.0 ke 0.18.0 dalam tujuh hari (enam rilis stabil). Ada nightly harian sejak 8 Oktober. Rilis 0.17.0 membawa dua breaking change dan me-rekey replay cache ([Release 0.17.0](https://github.com/tester-army/e2e/releases/tag/e2e%400.17.0)). Vendor sendiri bilang API-nya masih akan berubah sebelum 1.0 ([Introducing e2e](https://tester.army/blog/introducing-e2e)).

Download npm `e2e` mencapai 142.735 per bulan, tapi 133.700 di antaranya terjadi di minggu peluncuran. Angka itu belum bisa dibaca sebagai sinyal adopsi ([npm downloads](https://api.npmjs.org/downloads/point/last-month/e2e)). Ada 29 kontributor manusia, tapi okwasniewski (CTO) menulis 560 dari 726 commit ([GitHub contributors](https://github.com/tester-army/e2e/graphs/contributors)).

Di sisi positif, dokumentasinya luar biasa rinci untuk produk seumur ini:

- daftar error code tertutup;
- skema report `report-1`;
- `spiVersion` untuk engine;
- pesan migrasi eksplisit untuk key yang dihapus ([errors](https://e2e.tester.army/docs/reference/errors); [CLI](https://e2e.tester.army/docs/reference/cli)).

Satu catatan: contoh di docs masih menampilkan versi 0.13 dan 0.14, dan halaman "Security rules" live lebih baru dari docs yang diunduh. Jadi docs tertinggal dari release train.

### Tanggapan komunitas

**Tanggapan komunitas masih tipis dan sebagian bias.**

- **Hacker News.** Launch HN untuk produk hosted TesterArmy (Juni 2026, 132 poin, 69 komentar) skeptis soal empat hal: biaya token, nondeterminisme, ketergantungan pada SaaS, dan jawaban founder yang di-copy-paste. CTO-nya mengakui belum punya benchmark ([Launch HN](https://news.ycombinator.com/item?id=48586299)). Submission repo e2e sendiri ke HN hanya dapat 1 poin tanpa komentar ([HN Algolia](https://hn.algolia.com/api/v1/search?query=testerarmy&tags=story)).
- **DEV.** Ulasan teknis terbaik ada di DEV. Penulisnya memuji desain hybrid dan replay cache. Kritiknya: judgment tidak pernah di-cache, fallback live terjadi diam-diam (14,6 s vs 0,2 s), retry membayar model lagi, dan telemetry menyala default. Tapi pengujiannya memakai model tiruan, bukan LLM sungguhan ([DEV](https://dev.to/ianwieds/let-the-ai-click-dont-let-it-grade-3abo)).
- **TestMu AI.** Tulisannya positif, tapi ada konflik kepentingan karena mengarahkan config ke endpoint mereka sendiri ([TestMu AI](https://www.testmuai.com/blog/e2e-by-testerarmy/)).
- **Reddit.** Tidak ditemukan diskusi.

### Perusahaan dan harga hosted

**TesterArmy adalah startup enam orang di Warsawa,** angkatan YC Spring 2026. Pendirinya mantan engineer React Native dari lingkungan Callstack ([YC](https://www.ycombinator.com/companies/testerarmy)). Pendanaan pre-seed-nya €1,04 juta ([The Recursive](https://www.therecursive.com/yc-proven-testerarmy-raises-eur1m-for-ai-agents-that-test-software.md)). Produk hosted mereka berbeda dari e2e: tes ditulis dalam bahasa biasa di dashboard dan dijalankan di cloud TesterArmy. Peluncurannya menyebut e2e sebagai fondasi yang baru "nanti" akan dipakai produk hosted ([tester.army/e2e](https://tester.army/e2e); [Introducing e2e](https://tester.army/blog/introducing-e2e)). Harganya per run:

| Plan | Harga/bulan | Run | Paralel | Catatan |
|---|---|---|---|---|
| Free | $0 | 5 | 1 | tanpa kartu |
| Hobby | $99 | ≤250 | 3 | GitHub, Slack, webhook |
| Startup | $299 | ≤1.000 | 10 | tambah "frontier models" |
| Enterprise | custom | – | – | SSO/SAML |

Sumber: [tester.army/pricing](https://tester.army/pricing). e2e versi open-source gratis, dan biayanya hanya token model kita sendiri.

## Alternatif: tak ada yang menutup web, mobile, dan model sendiri sekaligus

**Posisi khas e2e adalah satu runner Apache-2.0 yang mencampur locator dan langkah agent di web, iOS, dan Android, dengan replay cache dan model pilihan sendiri.** Setiap alternatif hanya menutup sebagian dari kombinasi itu. Tabel di bawah adalah snapshot 9 Oktober 2026. "n/v" berarti belum diverifikasi dari sumber primer.

| Tool | Jenis, lisensi, bintang | Web | Mobile | Cara AI | Biaya | Relevansi untuk itulah |
|---|---|---|---|---|---|---|
| **e2e (TesterArmy)** | OSS, Apache-2.0, 8,3k | Ya (Playwright) | iOS sim, Android emu, HP USB | Locator + `act` di-cache; judgment live | Gratis + token | Pilot web, kandidat utama |
| **Playwright + Test Agents** | OSS, Apache-2.0, 97k | Ya | Tidak | Planner/generator/healer menulis kode Playwright biasa; nol AI saat runtime | Gratis; token hanya saat menulis/healing | Alternatif terkuat untuk web; satu-satunya jalur WebView2 yang terdokumentasi |
| **Stagehand** | OSS SDK (MIT, 25,6k) + browser hosted | Ya | Tidak | `act/extract/observe`, cache dengan self-healing | Gratis + LLM | SDK, bukan test runner |
| **Midscene.js** | OSS, MIT, 15,1k | Ya | Ya | Vision murni dari screenshot | Gratis + token vision model | Cocok untuk kanvas; boros untuk form |
| **Maestro** | OSS CLI (Apache-2.0, 16k) + cloud | Ya | Ya | Flow YAML; AI assert lewat cloud mereka | Lokal gratis; cloud $250/device/bulan | Kandidat tablet nanti |
| **Detox + Wix Pilot** | OSS, MIT, 12k | Tidak | Ya (React Native) | Langkah natural-language, model sendiri | Gratis + token | Tidak relevan (tablet pakai Compose) |
| **Appium + appium-mcp** | OSS, Apache-2.0, 22k | Lewat WebDriver | Ya, termasuk HP fisik | MCP dengan vision finder | Gratis + token | Berat untuk tim kecil |
| **Browser Use** | OSS (MIT, 117k) + cloud | Ya | Tidak | Agent umum, bukan test runner | Cloud $0,01/task + per step | Tidak cocok untuk regresi |
| **agent-browser** (dipakai `pos-flow`) | CLI lokal | Ya | Tidak | Kita sendiri yang menulis layer locator | Gratis | Status quo; 32/32 hijau |
| **Momentic** | Berbayar | Chromium | Simulator/emulator | YAML + cache locator yang auto-heal | ~$250+/bulan (n/v) | Vendor lock-in |
| **QA Wolf** | Jasa managed | Ya | n/v | Manusia + AI menulis Playwright | ~$40–44/tes/bulan, kontrak 12 bulan (n/v) | Terlalu mahal |
| **Octomind** | Berbayar | Ya | n/v | Tes yang dibuat AI | $0 / $299 / enterprise | Data rig harus keluar |
| **TesterArmy hosted** | Berbayar | Ya | Simulator | Tes bahasa biasa di dashboard | $0 / $99 / $299 / custom | Tidak perlu; e2e OSS cukup |

Sumber tabel: [Playwright](https://github.com/microsoft/playwright), [Playwright Test Agents](https://github.com/microsoft/playwright/blob/main/docs/src/test-agents-js.md), [Stagehand](https://github.com/browserbase/stagehand), [Midscene](https://github.com/web-infra-dev/midscene), [Maestro pricing](https://maestro.dev/pricing), [Detox](https://github.com/wix/Detox), [Appium](https://github.com/appium/appium), [Browser Use pricing](https://docs.cloud.browser-use.com/pricing), [Momentic](https://momentic.ai/docs/auto-heal), [QA Wolf (Bug0)](https://bug0.com/knowledge-base/qa-wolf-pricing), [Octomind](https://www.octomind.dev/pricing).

Untuk itulah, pilihan realistisnya cuma tiga:

- **e2e.** Langkah agent tetap hidup saat runtime: kalau UI berubah, agent mengambil alih lalu merekam ulang. Ada juga judgment semantik untuk aturan layout seperti "aksi di bawah, tidak ada scroll horizontal". Ini cocok dengan hub yang tata letaknya sering didesain ulang.
- **Playwright Test Agents.** Hasilnya kode Playwright deterministik murni tanpa ketergantungan AI saat runtime, dari proyek dengan 97 ribu bintang. Ini pilihan paling aman kalau kita hanya butuh tes web yang stabil.
- **Tetap dengan `agent-browser`.** Gratis dan sudah terbukti di `pos-flow`. Tapi kita harus memelihara sendiri layer locator, report, dan semua yang lain.

Shortest dari Antiwork sudah dorman sejak 2025, jadi tidak perlu dipertimbangkan ([Shortest](https://github.com/antiwork/shortest)).

## Di itulah: cocok untuk hub, store app, dan kasir web edition

### Kondisi testing sekarang

**Repo belum punya test runner frontend sama sekali, jadi e2e akan menjadi yang pertama, bukan migrasi.** Semua frontend (`frontend-hub`, `frontend-store-new`, `frontend-customer`, `frontend-employee`, `pos-desktop/ui`) adalah SPA Vite + React 19 tanpa Playwright, Vitest, atau Jest ([frontend-hub/package.json](/Users/hari/Documents/itulah/frontend-hub/package.json)). Atribut `data-testid` nol, sedangkan `aria-label=` muncul 605 kali di `frontend-hub/src`. Jadi locator harus memakai role, label, dan text, dan untungnya hub kaya label. CI hanya mengecek Rust dan contract, dan job `lints`/`tests`-nya sendiri sedang merah ([ci.yml](/Users/hari/Documents/itulah/.github/workflows/ci.yml)). Node lokal v24.21.0, sudah memenuhi syarat 24.8+.

**Pembagian kerja dengan dua script yang sudah ada:**

- **`po-flow` tetap seperti sekarang.** Ini tes invarian berbasis API, ditulis dalam Python (685 baris). Cakupannya seluruh rantai barang: PO, DC, allotment, toko, kasir, retur. Cepat, tanpa model, dan memeriksa angka ([e2e/po-flow/run.py](/Users/hari/Documents/itulah/e2e/po-flow/run.py)).
- **`pos-flow` adalah yang paling tumpang tindih dengan e2e.** Script Python ini (618 baris) menggerakkan kasir, store app, dan hub lewat `agent-browser`, dengan layer locator buatan sendiri yang mem-parse snapshot `- role "name" [ref=eN]`. Hasil layar dicocokkan dengan API node. Run terakhirnya hijau 32/32 ([e2e/pos-flow/run.py](/Users/hari/Documents/itulah/e2e/pos-flow/run.py); [report 20260928](/Users/hari/Documents/itulah/runs/pos-e2e/report/20260928-153148/report.md)). Class `Browser` dan `Api` di sana akan digantikan langsung oleh `screen` dan fixture `fetch`. Tapi script ini sudah deterministik dan gratis, jadi port-nya urutan kedua, bukan pilot.
- **Yang benar-benar baru dari e2e:** cakupan UI untuk alur hub yang selama ini hanya dicek manual (composer PO, Review count, cabang Receiving, New articles, allotment, outbound). Juga tes bertipe dalam bahasa yang sama dengan aplikasi, session yang bisa dipakai ulang, trace per langkah, dan jalur ke CI.

### Permukaan yang bisa dijangkau

| Permukaan | Cara | Kecocokan |
|---|---|---|
| Hub (Central) | Web engine ke Vite rig (`pos-e2e-hub` :5480 → cloud 8480) | Tinggi; target pilot pertama |
| Store app | Web engine (:5482 → store 8482) | Tinggi |
| Kasir web edition | Web engine ke `pos-desktop/ui` mode web (:5484); token di sessionStorage | Tinggi; jalur yang lebih bersih daripada shim `pos-flow` |
| Kasir Tauri desktop | Tidak ada engine; UI-nya memanggil node lewat `edge_call` milik shell dan menolak jalan di luar shell | Rendah; tunda |
| Kasir tablet | Mobile engine (agent-device) ke emulator, APK debug sudah ada, tapi nol `testTag` dan input RFID-first | Rendah; setelah pilot web |
| Hardware (R3, EDC, sidik jari, printer, laci) | Tidak terjangkau engine mana pun | Tetap manual atau simulator |

Sumber: [launch.json](/Users/hari/Documents/itulah/.claude/launch.json), [tauri.conf.json](/Users/hari/Documents/itulah/pos-desktop/src-tauri/tauri.conf.json), [edition.ts](/Users/hari/Documents/itulah/pos-desktop/ui/src/edition.ts), [pos-flow README](/Users/hari/Documents/itulah/e2e/pos-flow/README.md), [tablet build.gradle.kts](/Users/hari/Documents/itulah/tablet/app/build.gradle.kts).

### Sign-in, locale, dan viewport

**Hub dan store app login dengan username dan password,** lalu mendapat cookie session HttpOnly plus cookie CSRF ([auth.rs](/Users/hari/Documents/itulah/backend/src/cloud/http/auth.rs); [login-form.tsx](/Users/hari/Documents/itulah/frontend-hub/src/components/login-form.tsx)). Session e2e menyimpan cookie, localStorage, dan IndexedDB, jadi satu `test.setup` per role sudah pas.

**Kasir web menyimpan token di sessionStorage, yang tidak ikut session e2e.** Jadi kasir harus login di dalam tiap tes ([web.ts](/Users/hari/Documents/itulah/pos-desktop/ui/src/web.ts)).

**Login lewat form password mematikan screenshot.** Akibatnya cek `vision: true` untuk layout phone butuh setup yang login lewat API lalu menyuntik cookie dengan `browser.setCookies`, karena login seperti itu tidak menghitung sebagai secret fill ([Security model](https://e2e.tester.army/docs/security)).

**Format uang di-hard-code `id-ID`,** jadi locale browser tidak berpengaruh ([format.ts](/Users/hari/Documents/itulah/frontend-hub/src/lib/format.ts)). `timezoneId: 'Asia/Jakarta'` tetap perlu, karena tanggal bisnis dihitung dalam WIB.

**Viewport 414×896 hanya menguji layout berbasis lebar.** Ada tiga bagian yang tidak tersentuh:

- perilaku `(pointer: coarse)`, seperti NumberPad dan perilaku tombol sentuh ([button.tsx](/Users/hari/Documents/itulah/frontend-hub/src/components/ui/button.tsx));
- outbox PO offline ([po-outbox.ts](/Users/hari/Documents/itulah/frontend-hub/src/lib/offline/po-outbox.ts));
- emulasi `offline` itu sendiri, karena e2e belum mendukungnya.

### Model

**Paket `e2e/agentic/` sudah memasang `@ai-sdk/anthropic`.** Jalur termudah adalah `ANTHROPIC_API_KEY`, termasuk dari kredit API Claude Max/Team kalau ada ([package.json](/Users/hari/Documents/itulah/e2e/agentic/package.json); [Subscriptions](https://e2e.tester.army/docs/subscriptions)). Jalur OpenRouter juga bisa dengan menambah `@openrouter/ai-sdk-provider`. Kuncinya sudah dipakai backend untuk Gemma 4 dengan `zdr: true` ([assistant.rs](/Users/hari/Documents/itulah/backend/src/cloud/http/assistant.rs)). Tapi built-in agent butuh model dengan tool call dan input gambar. Kualitas Gemma 4 untuk `act` multi-langkah belum terbukti, jadi coba dia hanya sebagai lantai biaya setelah cache hangat. Soal ZDR: perlu dicek apakah provider OpenRouter AI SDK bisa meneruskan `provider.zdr`. Kalau tidak, pakai setelan privasi di level akun.

### Risiko utama

**Risiko paling praktis bukan di framework-nya, tapi di rig.**

- **Tes mengubah data rig.** Tes memakan stok dan mencetak nomor PO baru. Rig `pos-e2e` adalah rig yang dipakai Hari sehari-hari sebagai rina. `pos-flow` sendiri hanya bisa diulang selama stok di lantai toko masih ada (dua unit per run) ([pos-flow README](/Users/hari/Documents/itulah/e2e/pos-flow/README.md)). Jadi rig untuk e2e harus terpisah dan di-reset tiap suite.
- **Runner hanya menyalakan app.** `app.command` tidak menyalakan Postgres atau node. `rig.sh` dan seed tetap jalan duluan ([Web](https://e2e.tester.army/docs/web); [rig.sh](/Users/hari/Documents/itulah/scripts/rig.sh)).
- **Tidak ada origin allowlist.** `launch.json` punya entri yang mengarah ke host remote. Target pilot harus loopback saja, dan kita tidak bisa mengandalkan agent sebagai penjaga.
- **Data seed tampil di layar.** Seed menampilkan data yang mirip data pribadi (nama dan nomor HP member demo), dan teks layar itu sampai ke provider model. Masih bisa diterima untuk data demo, asal provider-nya ZDR atau model lokal.
- **Pre-1.0.** Pin versi persis dan review diff cache setiap kali upgrade.

## Pilot dua minggu: tiga tes di rig terpisah

### Rencana

| Langkah | Kapan | Isi | Selesai kalau |
|---|---|---|---|
| 1. Paket | Hari 1 | Lanjutkan `e2e/agentic/` yang sudah ada. Tambah `hub.config.ts`, `hub-phone.config.ts`, `till.config.ts`, dan `support/rig.ts` (klien API bearer per node, seperti `Rig` di `po-flow`). Jalankan `npx @e2e-dev/web install chromium`. Model dan judge dari env var | Tes `app opens` hijau tanpa model |
| 2. Rig | Hari 1–2 | `RIG_PORT_CLOUD=8580 RIG_PORT_DC=8581 RIG_PORT_STORE=8582 RIG_AUTH_MODE=required RIG_CLOCK=system scripts/rig.sh new agentic`, lalu seed seperti `provision.sh`. Vite hub/store/kasir di port baru (salin entri `pos-e2e-*`) | Rig `pos-e2e` tidak tersentuh |
| 3. Tes | Hari 3–6 | Tiga tes di bawah, plus dua setup sign-in | Tiap tes hijau sekali |
| 4. Ukur | Minggu 2 | Tiap tes 3×: `--no-cache`, warm, lalu setelah `rig.sh reset`. Catat baris `Cache`, model calls, biaya (`--debug`), dan waktu | Angka tercatat per tes |
| 5. Uji false pass | Minggu 2 | Ubah satu label atau revert satu fix, lalu pastikan tesnya merah | Tidak ada pass palsu |
| 6. Putuskan | Akhir minggu 2 | Commit `.e2e/cache/` setelah review? `--strict-cache`? Port `pos-flow`? Job CI (butuh Postgres + build Rust)? | Keputusan tertulis |

**Kriteria sukses:**

- Suite hijau dari rig segar.
- Run kedua memutar ulang sebagian besar `act` dengan nol model call.
- Tidak ada false pass.
- Tes 2 menangkap bug "PO batal masih bisa di-receive" kalau bug itu masih terbuka, atau menjaga fix-nya kalau sudah diperbaiki.

**Perkiraan biaya:** dari rata-rata per langkah hasil evaluasi Sonnet 5.5 di atas, satu run penuh pilot (sekitar 5 act, 4 judgment, 1 extract) kira-kira $0,13 dalam keadaan dingin dan sekitar $0,04 setelah act ter-replay. Dua minggu pilot kemungkinan jauh di bawah $10. Ini hitungan saya sendiri, bukan angka yang dipublikasikan.

**Di luar scope pilot:** tablet, Tauri, CI, dan port `po-flow`.

### Config per aplikasi

Pakai config terpisah per aplikasi dan per ukuran layar, karena setiap tes jalan di semua target, dan `platforms`/`requires` tidak bisa memilih viewport ([Web](https://e2e.tester.army/docs/web)):

```ts
// e2e/agentic/hub.config.ts (sketsa; hub-phone.config.ts sama, viewport 414×896, tests: ['tests/hub-phone/**/*.e2e.ts'])
import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { anthropic } from '@ai-sdk/anthropic';

export default {
  tests: ['tests/hub/**/*.e2e.ts'],
  targets: [{
    name: 'hub-desk',
    engine: web({ viewport: { width: 1440, height: 900 }, timezoneId: 'Asia/Jakarta' }),
    app: { url: process.env.HUB_URL ?? 'http://localhost:5580' },
  }],
  agents: {
    default: {
      model: anthropic(process.env.E2E_MODEL ?? 'claude-sonnet-5-5'),
      judge: anthropic(process.env.E2E_JUDGE ?? 'claude-sonnet-5-5'),
    },
  },
  credentials: { rina: { username: 'rina', password: process.env.RIG_PASSWORD ?? '' } },
} satisfies E2EConfig;
```

### Sketsa 1: sign-in hub dan pembuatan PO

Ada tiga koreksi dari sketsa di catatan fit:

- Tag yang berubah tiap run dibungkus `unique()`, supaya `act`-nya bisa di-replay.
- Nilai supplier dan catatan dibuat tidak saling memuat, supaya tidak kena `param-collision`.
- Nomor PO dicetak aplikasi (gap `minted-token`), jadi dibuktikan lewat API, bukan lewat replay.

```ts
// tests/hub/auth.setup.e2e.ts
import { test } from '@e2e-dev/web';
import { expect, credentials } from 'e2e';

test.setup('rina masuk ke Central', { sessions: ['rina'] }, async ({ app, screen, session }) => {
  const rina = credentials.user('rina');               // password = Secret, tidak pernah dilihat model
  await app.open('/');
  await screen.getByLabel('Username').fill(rina.username);
  await screen.getByLabel('Password').fill(rina.password);
  await screen.getByRole('button', 'Sign in').tap();
  await expect(screen.getByRole('button', 'Sign in')).toBeHidden();   // deterministik, tanpa model
  await session.save('rina');
});

// tests/hub/po-create.e2e.ts
import { test } from '@e2e-dev/web';
import { expect, unique } from 'e2e';
import { z } from 'zod';
import { rig } from '../../support/rig';

test('buyer membuat PO dan PO-nya muncul di list', { session: 'rina' }, async ({ app, agent, screen }) => {
  const run = Date.now().toString(36);
  const supplier = await rig.cloud('rina').createSupplier({ name: `QA ${run}` });   // POST /api/v1/suppliers
  await app.open('/procurement/orders');
  await agent.act(
    'Start a new order for supplier {supplier}, add {qty} pcs of the first article offered, ' +
    'write {note} in the notes, review it and submit it',
    { params: { supplier: unique(supplier.name), qty: '12', note: unique(`note-${run}`) } },
  );
  const po = await agent.extract('the number and status of the order just submitted', {
    schema: z.object({ number: z.string().regex(/^PO-\d{6}-\d{3}$/), status: z.string() }),
  });
  await expect(screen.getByText(po.number)).toBeVisible();     // pengecekan locator: membuat act di atas bisa direkam
  const row = await rig.cloud('rina').findPo(po.number);       // GET /api/v1/purchase-orders
  expect(row.lines[0].quantity).toBe(12);                      // angka dinilai lewat API, bukan oleh model
});
```

### Sketsa 1b: aturan layout phone dengan screenshot

Session-nya dibuat lewat login API, jadi pixel tetap tersedia untuk `vision`.

```ts
// tests/hub-phone/po-list.e2e.ts   (hub-phone.config.ts, 414×896)
test.setup('rina via API', { sessions: ['rina-api'] }, async ({ app, browser, session }) => {
  // POST /api/v1/auth/login ke cloud → cookie session + CSRF. Password rig adalah nilai demo, bukan Secret.
  const cookies = await rig.cloud.loginCookies('rina', process.env.RIG_PASSWORD!, app.baseUrl!);
  await browser.setCookies(cookies);                            // tidak ada secret fill → screenshot tetap ada
  await app.open('/procurement/orders');
  await session.save('rina-api');
});

test('phone: aksi PO di bawah, tidak ada yang geser ke samping', { session: 'rina-api' }, async ({ app, agent }) => {
  await app.open('/procurement/orders');
  await agent.assert(
    'the New order action sits at the bottom of the screen and no table or strip scrolls sideways',
    { vision: true },
  );
});
```

Ada dua hal yang perlu dicek di sini. Pertama, apakah login lewat API "menendang" session browser lain. Catatan memori bilang curl login menendang browser, sedangkan `security.rs` bilang one-device sign-in mati secara default. Kedua, apakah tes ini perlu `initScripts` yang mem-patch `matchMedia('(pointer: coarse)')` supaya jalur phone yang berbasis sentuh ikut teruji. Patch itu workaround, bukan fitur e2e.

### Sketsa 2: regresi "PO yang dibatalkan masih bisa di-receive"

Bug ini dari pass 2 Oktober: dengan count yang menunggu, Cancel tetap diizinkan, sheet masih menampilkan Review count, lalu Receive ternyata berhasil ([E2E-TEST-REPORT-2026-10-02.md](/Users/hari/Documents/itulah/E2E-TEST-REPORT-2026-10-02.md)).

```ts
// tests/hub/po-cancelled-not-receivable.e2e.ts
test('PO yang dibatalkan saat count menunggu tidak bisa di-receive', { session: 'rina' }, async ({ app, agent, screen }) => {
  const run = Date.now().toString(36);
  const po = await rig.cloud('rina').createPo({ tag: `UJI-${run}`, qty: 2 });   // seperti po-flow fase 1/4
  await rig.dc('yusuf').countDelivery(po.id, { qty: 2 });                     // POST /api/v1/dc/purchase-counts
  await app.open('/procurement/orders');
  await agent.act('Open order {number} and cancel it with the reason {reason}',
    { params: { number: unique(po.number), reason: unique(`batal ${run}`) } });
  await agent.assert('the order shows as Cancelled');                         // mengonfirmasi act untuk cache
  await expect(screen.getByRole('button', 'Review count')).toBeHidden();      // label dari laporan bug; cek ulang
  const res = await rig.dc('yusuf').tryReceive(po.id);                        // misalnya /api/v1/dc/goods-receipts
  expect(res.ok).toBe(false);                                                 // bukti di sumber, bukan di layar
  expect((await rig.cloud('rina').getPo(po.id)).received_quantity).toBe(0);
});
```

Kalau bug ini masih terbuka, tes akan merah di `toBeHidden` atau di percobaan receive lewat API. Setelah bug diperbaiki, tes ini menjaga fix-nya. Ini cara paling bersih untuk menilai apakah e2e layak dipertahankan.

### Sketsa 3: penjualan tunai di kasir web

Ini port dari bagian kasir di `pos-flow`. Kasir login di dalam tes karena tokennya ada di sessionStorage.

```ts
// tests/till/cash-sale.e2e.ts   (till.config.ts → kasir web edition)
import { test } from '@e2e-dev/web';
import { expect, credentials } from 'e2e';

test('kasir menjual 1 unit tunai, total di layar = quote node', async ({ app, screen, agent }) => {
  const dian = credentials.user('dian');
  const unit = await rig.store('maya').pickFloorUnit();                 // seperti pick_units() di pos-flow
  const quote = await rig.store('maya').quote(unit.epc);                // POST /api/v1/store/quote
  await app.open('/');
  await screen.getByLabel('Nama pengguna').fill(dian.username);
  await screen.getByLabel('Kata sandi').fill(dian.password);
  await screen.getByRole('button', 'Masuk').tap();
  await agent.act('If a shift has to be opened, open it with {float} as opening cash', { params: { float: '500000' } });
  await screen.getByLabel('Pindai tag').fill(unit.epc);
  await screen.getByLabel('Pindai tag').press('Enter');
  await expect(screen.getByRole('button', /^Bayar/)).toContainText(idr(quote.total_minor));  // "170.000", aman dari NBSP
  await agent.act('Pay in cash with the smallest suggested amount above the total and complete the sale');
  await expect(screen.getByText('Transaksi selesai')).toBeVisible();
  const sale = await rig.store('maya').latestSale();
  expect(sale.total_minor).toBe(quote.total_minor);
});
```

Format `id-ID` menaruh no-break space setelah "Rp", sedangkan nama locator dicocokkan persis. Karena itu tombol Bayar dicari dengan RegExp, lalu angkanya dicek dengan `toContainText`. Sketsa ini tidak memakai cek pixel, jadi tidak masalah kalau screenshot mati setelah password diisi.

### Setelah pilot

Kalau pilot lolos, urutannya:

1. Port sisa `pos-flow` (rekonsiliasi store app dan hub) memakai `support/rig.ts` yang sama.
2. Ubah pass manual 1–2 Oktober (cabang Receiving, allotment, outbound) menjadi tes dengan langkah agent.
3. Coba satu bug bash bertag `bugbash` di branch yang banyak mengubah UI.
4. Baru setelah itu pertimbangkan tablet lewat mobile engine (tambah `testTag` + `testTagsAsResourceId`) dan job CI.

## Kesimpulan

Nilai e2e untuk itulah bukan "AI yang menguji". Nilainya ada di mengubah pass manual berbasis agent yang sudah kita jalankan menjadi sesuatu yang bisa diulang, punya report, dan makin murah setiap kali dijalankan. Syaratnya satu disiplin yang tegas: agent hanya mengklik, sedangkan yang menilai adalah `expect` dan API node. Tanpa disiplin itu, biaya tidak turun, karena judgment selalu live. Kesalahan juga bisa lolos, karena cache stale diam-diam diambil alih agent. Dengan disiplin itu, e2e praktis menjadi Playwright yang langkah-langkahnya direkam AI, ditambah cadangan agent saat layout hub berubah. Untuk aplikasi yang tampilannya didesain ulang tiap minggu, itu persis yang dibutuhkan.

Hambatan terbesarnya justru di sisi kita, bukan di framework: rig yang bisa di-reset dan diisi ulang dengan cepat, data uji yang unik per run, dan CI yang mampu menyalakan Postgres plus binary Rust. Untuk desktop Tauri dan tablet, jawabannya bukan "tidak pernah", tapi "nanti". Tunggu sampai e2e punya engine desktop atau sampai pilot web terbukti, lalu tambahkan `testTag` di tablet. Karena proyeknya berganti versi hampir tiap hari, pin versi dan cache yang direview adalah syarat, bukan pilihan.

## Sumber

**Dokumentasi e2e (e2e.tester.army)**
- Index (llms.txt): https://e2e.tester.army/docs/llms.txt
- Quickstart: https://e2e.tester.army/docs/quickstart
- Core concepts: https://e2e.tester.army/docs/core-concepts
- How agent steps work: https://e2e.tester.army/docs/agent-steps
- Caching: https://e2e.tester.army/docs/cache
- Models: https://e2e.tester.army/docs/models
- Subscriptions: https://e2e.tester.army/docs/subscriptions
- Coding agents: https://e2e.tester.army/docs/coding-agents
- Exploring without a test: https://e2e.tester.army/docs/explore
- Bug bashes: https://e2e.tester.army/docs/bug-bash
- Security model: https://e2e.tester.army/docs/security
- Security rules: https://e2e.tester.army/docs/reference/security
- Telemetry: https://e2e.tester.army/docs/telemetry
- Signing in: https://e2e.tester.army/docs/authentication
- Web: https://e2e.tester.army/docs/web
- Working with the browser: https://e2e.tester.army/docs/browser
- Mobile: https://e2e.tester.army/docs/mobile
- API: https://e2e.tester.army/docs/api-testing
- Visual comparison: https://e2e.tester.army/docs/visual-testing
- Debugging a run: https://e2e.tester.army/docs/debugging
- Continuous integration: https://e2e.tester.army/docs/ci
- GitHub Actions: https://e2e.tester.army/docs/ci/github-actions
- EAS Workflows: https://e2e.tester.army/docs/ci/eas-workflows
- Bitrise: https://e2e.tester.army/docs/ci/bitrise
- Codemagic: https://e2e.tester.army/docs/ci/codemagic
- Pull request comments: https://e2e.tester.army/docs/github
- Kernel browsers: https://e2e.tester.army/docs/integrations/kernel
- EAS Simulators: https://e2e.tester.army/docs/integrations/eas
- smol machines browsers: https://e2e.tester.army/docs/integrations/smol
- Writing an engine: https://e2e.tester.army/docs/writing-an-engine
- Example projects: https://e2e.tester.army/docs/example-projects
- From Playwright: https://e2e.tester.army/docs/migrate/playwright
- Reference — test: https://e2e.tester.army/docs/reference/test
- Reference — agent: https://e2e.tester.army/docs/reference/agent
- Reference — screen: https://e2e.tester.army/docs/reference/screen
- Reference — expect: https://e2e.tester.army/docs/reference/expect
- Reference — app: https://e2e.tester.army/docs/reference/app
- Reference — config: https://e2e.tester.army/docs/reference/config
- Reference — CLI: https://e2e.tester.army/docs/reference/cli
- Reference — MCP: https://e2e.tester.army/docs/reference/mcp
- Reference — reporters: https://e2e.tester.army/docs/reference/reporters
- Reference — environment: https://e2e.tester.army/docs/reference/environment
- Reference — errors: https://e2e.tester.army/docs/reference/errors
- Reference — browser: https://e2e.tester.army/docs/reference/web
- Reference — mobile: https://e2e.tester.army/docs/reference/mobile
- Reference — engine: https://e2e.tester.army/docs/reference/engine

**Repo, rilis, npm, issue**
- Repo: https://github.com/tester-army/e2e
- GitHub API repo: https://api.github.com/repos/tester-army/e2e
- Contributors: https://github.com/tester-army/e2e/graphs/contributors
- Packages: https://github.com/tester-army/e2e/tree/main/packages
- Release e2e@0.17.0: https://github.com/tester-army/e2e/releases/tag/e2e%400.17.0
- Issue #1000: https://github.com/tester-army/e2e/issues/1000
- Issue #963: https://github.com/tester-army/e2e/issues/963
- Issue #884: https://github.com/tester-army/e2e/issues/884
- Issue #885: https://github.com/tester-army/e2e/issues/885
- Issue #841: https://github.com/tester-army/e2e/issues/841
- Issue #797: https://github.com/tester-army/e2e/issues/797
- Issue #986: https://github.com/tester-army/e2e/issues/986
- npm e2e: https://registry.npmjs.org/e2e
- npm @e2e-dev/web: https://registry.npmjs.org/@e2e-dev%2Fweb
- npm downloads: https://api.npmjs.org/downloads/point/last-month/e2e
- agent-device: https://github.com/callstack/agent-device

**Perusahaan, harga, komunitas**
- Introducing e2e: https://tester.army/blog/introducing-e2e
- tester.army/e2e: https://tester.army/e2e
- Harga hosted: https://tester.army/pricing
- YC: https://www.ycombinator.com/companies/testerarmy
- The Recursive: https://www.therecursive.com/yc-proven-testerarmy-raises-eur1m-for-ai-agents-that-test-software.md
- Launch HN: https://news.ycombinator.com/item?id=48586299
- HN Algolia: https://hn.algolia.com/api/v1/search?query=testerarmy&tags=story
- Trendshift: https://trendshift.io/repositories/274762
- AIcoder: https://aicoder.com/news/news-20261005-testerarmy-e2e-ai-testing-framework
- DEV, "Let the AI click, don't let it grade": https://dev.to/ianwieds/let-the-ai-click-dont-let-it-grade-3abo
- TestMu AI: https://www.testmuai.com/blog/e2e-by-testerarmy/
- tests-e2e evaluation: https://github.com/slawekradzyminski/tests-e2e/blob/main/evaluation/FOUR_OPERATIONS.md

**Alternatif**
- Playwright: https://github.com/microsoft/playwright
- Playwright Test Agents: https://github.com/microsoft/playwright/blob/main/docs/src/test-agents-js.md
- Playwright WebView2: https://playwright.dev/docs/webview2
- Stagehand: https://github.com/browserbase/stagehand
- Midscene.js: https://github.com/web-infra-dev/midscene
- Shortest: https://github.com/antiwork/shortest
- Browser Use pricing: https://docs.cloud.browser-use.com/pricing
- Maestro pricing: https://maestro.dev/pricing
- Detox: https://github.com/wix/Detox
- Appium: https://github.com/appium/appium
- Momentic: https://momentic.ai/docs/auto-heal
- QA Wolf (Bug0): https://bug0.com/knowledge-base/qa-wolf-pricing
- Octomind pricing: https://www.octomind.dev/pricing

**Repo itulah (lokal)**
- /Users/hari/Documents/itulah/e2e/agentic/package.json
- /Users/hari/Documents/itulah/e2e/po-flow/run.py
- /Users/hari/Documents/itulah/e2e/pos-flow/run.py
- /Users/hari/Documents/itulah/e2e/pos-flow/README.md
- /Users/hari/Documents/itulah/e2e/pos-flow/provision.sh
- /Users/hari/Documents/itulah/scripts/rig.sh
- /Users/hari/Documents/itulah/.claude/launch.json
- /Users/hari/Documents/itulah/.github/workflows/ci.yml
- /Users/hari/Documents/itulah/E2E-TEST-REPORT-2026-10-02.md
- /Users/hari/Documents/itulah/frontend-hub/package.json
- /Users/hari/Documents/itulah/frontend-hub/src/components/login-form.tsx
- /Users/hari/Documents/itulah/frontend-hub/src/lib/format.ts
- /Users/hari/Documents/itulah/frontend-hub/src/components/ui/button.tsx
- /Users/hari/Documents/itulah/frontend-hub/src/lib/offline/po-outbox.ts
- /Users/hari/Documents/itulah/pos-desktop/src-tauri/tauri.conf.json
- /Users/hari/Documents/itulah/pos-desktop/ui/src/edition.ts
- /Users/hari/Documents/itulah/pos-desktop/ui/src/web.ts
- /Users/hari/Documents/itulah/tablet/app/build.gradle.kts
- /Users/hari/Documents/itulah/backend/src/cloud/http/auth.rs
- /Users/hari/Documents/itulah/backend/src/cloud/http/assistant.rs
