# Prototype General Affairs

Open <http://127.0.0.1:8767/> while the local preview server is running, or open `index.html` directly in a browser. To start the preview from the repository root:

```sh
python3 -m http.server 8767 --bind 127.0.0.1 --directory prototypes/ga
```

Prototype UI: seven GA menus, detail forms, documents, record links, history, search/site filter and 51 use cases. Switch the **Simulasi peran** control to Finance to review the shared bill queue, generate a recurring draft, post a reviewed example, and try a simulated payment.

All information is sample information in this browser's localStorage. Attachments are held locally with small demo limits. No external service or server database receives changes. Use **Ekspor data demo** to save the browser's current sample state as JSON.

For design decisions, detailed scenarios, and gaps against the actual repository APIs, see [GA-USE-CASES.md](GA-USE-CASES.md). `model.test.cjs` checks the scenario rules; run `node prototypes/ga/model.test.cjs`.
