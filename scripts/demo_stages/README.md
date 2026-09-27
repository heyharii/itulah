# demo stages

One file per domain, run by `scripts/demo-populate.py` in its `ORDER` after
the built-in `goods` stage. Each file exposes:

    def run(cloud, dc, store, ctx: dict) -> None

`cloud`, `dc`, `store` are `Node`s from demo-populate.py (`get`, `post`,
`call(method, path, body, ok=(200, 201))`; every write carries an
Idempotency-Key). `ctx` is shared between stages.

Rules: go through the routes the apps use, in the order the domain accepts;
SQL only where no route exists (say why, as seed-workplace.py does); skip work
already done so a re-run is harmless; IDR has no minor unit (Rp 1 = 1).
