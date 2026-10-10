# e2e (TesterArmy) — platform engines, CI, integrations, migration guides

Scope: what the open-source agentic testing framework `e2e` (npm `e2e`, engines `@e2e-dev/web` / `@e2e-dev/mobile`) can drive, how, and with which constraints. Primary source: the docs at https://e2e.tester.army/docs (snapshot of llms-full.txt, which matched the live file on 2026-10-09; the smol page is in llms.txt but not in llms-full.txt, so it was fetched live). Docs show `e2e 0.13.0` in a sample PR comment and pin `playwright-core` 1.63.0 (stated on the smol page) and agent-device 0.21.18 (mentioned in mobile troubleshooting).

General requirements: "Use Node.js 24.8 or newer (22.22.3 or newer on Node.js 22). On Windows, run inside WSL. Mobile tests also need Xcode with an iOS simulator runtime, or the Android SDK with an emulator." — [Quickstart](https://e2e.tester.army/docs/quickstart)

## Web engine: browsers, app start, baseURL, viewports, parallelism, mocking, dialogs, downloads, iframes, tabs, CDP attach / desktop webviews

### Takeaway
`@e2e-dev/web` is a Playwright-based engine (it pins its own `playwright-core`) that drives Chromium, Firefox and WebKit. It can start the app (`app.command`, like Playwright's `webServer`), test several viewports as separate targets, mock routes, handle dialogs, downloads, iframes and shadow DOM, and attach to a remote Chromium over CDP (`connect`) or a leased hosted browser (`BrowserProvider`). It drives only one active tab: popups and `window.open` are not followed. The docs never mention Electron, Tauri, WebView2 or WKWebView. There is no first-party desktop engine. Desktop apps are only named as something you could write your own engine for.

### Cited Findings
**Browsers and engine basis**
- "`@e2e-dev/web` runs tests in Chromium, Firefox, and WebKit. It is built on Playwright." — [Working with the browser](https://e2e.tester.army/docs/browser)
- "The package depends on `playwright-core` pinned to an exact version, so the engine always runs the Playwright it was tested against. An app that depends on Playwright itself keeps its own copy; the two share a browser cache only when their versions match." — [Browser reference](https://e2e.tester.army/docs/reference/web)
- Browser install command: `npx @e2e-dev/web install chromium --with-deps` (pnpm: `pnpm exec e2e-web install webkit --with-deps`). It accepts `chromium`, `firefox`, `webkit` and defaults to chromium. "A missing browser downloads once per run, before the run's clock starts." — [Browser reference](https://e2e.tester.army/docs/reference/web)
- The pinned version is `playwright-core` 1.63.0 "today" (the smol page tells users to install the same version for `connectOverCDP` in `prepare`). — [smol machines browsers](https://e2e.tester.army/docs/integrations/smol)

**Config shape: targets, app URL, baseURL**
- Minimal config:
  ```ts
  export default {
    targets: [{ engine: web(), app: { url: process.env.APP_URL ?? 'http://localhost:3000' } }],
  } satisfies E2EConfig;
  ```
  "`app.open('/path')` resolves against `app.url`... URLs without a scheme use HTTPS, or HTTP for loopback hosts." — [Web](https://e2e.tester.army/docs/web)
- The app is a target property, not an engine option. "`web({ url })` or any other app key on `web()` is an unknown key, `INVALID_CONFIG`". A web target refuses device keys (`bundleId`, `appPath`, `launchArguments`, `permissions`). "A target with `app.url` is a `browser` target, so `requires: ['browser']` selects web targets." — [Browser reference](https://e2e.tester.army/docs/reference/web)

**Starting the app (webServer equivalent)**
- `app.command` makes the runner spawn the server, wait until `app.url` answers, and stop it "when the run ends, fails, or is interrupted":
  ```ts
  app: {
    url: process.env.APP_URL ?? 'http://localhost:3000',
    command: { executable: 'npm', args: ['run', 'dev'], reuseExisting: true, log: '.e2e/logs/app.log' },
  },
  ```
  Options: `reuseExisting` ("CI ignores this and reports `APP_ALREADY_RUNNING`"), `log`, `env`, `startupTimeout` (60 s default), and `readyUrl` beside `command` for a health endpoint. "The command runs without a shell... The child inherits only `PATH`, `HOME`, the temp-directory variables, and `env`." — [Web](https://e2e.tester.army/docs/web)
- Free port: `url: 'http://127.0.0.1:0'` with `{port}` substituted in `args`/`env`. Tests read the allocated URL from `app.baseUrl`. "`localhost:0` is rejected." — [Web](https://e2e.tester.army/docs/web)
- Next.js 16 gotcha: a target opening `127.0.0.1` while `next dev` identifies as `localhost` "renders and never hydrates". Fix: `allowedDevOrigins: ['127.0.0.1']`. — [Web](https://e2e.tester.army/docs/web)
- Dependencies limit: "This version starts only `app.command`... Databases, mocks, and other processes the app needs are not started by the runner yet... A services API returns in a later release." — [Web](https://e2e.tester.army/docs/web)
- Protected previews: `web({ headers: { 'x-vercel-protection-bypass': ... } })`, `basicAuth: { username, password: secrets.get('previewPassword') }`, and `app.identity` for a stable cache identity when preview URLs change. "Setting `headers` disables the browser's HTTP cache and blocks service workers." — [Web](https://e2e.tester.army/docs/web)
- Other `web()` options: `testIdAttribute` (default `data-testid`), `userAgent`, `locale`, `timezoneId`, `initScripts`, `screencast: { size, quality }`, `connect`. — [Browser reference](https://e2e.tester.army/docs/reference/web)

**Viewports / targets**
- The default viewport is 1280×720. The pattern is one target per size:
  ```ts
  targets: [
    { name: 'desktop', engine: web(), app },
    { name: 'tablet', engine: web({ viewport: { width: 820, height: 1180 } }), app },
    { name: 'phone', engine: web({ browser: 'webkit', viewport: { width: 390, height: 844 } }), app },
  ],
  ```
  Each test runs once per target. Select one with `npx e2e run --target phone`. Targets that declare the same `app.command` share one process. — [Web](https://e2e.tester.army/docs/web)
- `viewport: null` fills the window (for headed runs or hosted live views). `browser.setViewport()` resizes within a test. "`platforms` and `requires` cannot select a viewport; all Playwright targets use platform `web`." — [Web](https://e2e.tester.army/docs/web)
- Limits: "A narrow viewport... still uses a desktop browser with a scale factor of 1, desktop pointer behavior, and its usual user agent. It does not emulate touch, color scheme, or reduced-motion preferences. Use the device engine for tests on a simulator or emulator." — [Web](https://e2e.tester.army/docs/web)
- These Playwright options are listed as "not yet": `devices['iPhone 15']`, `deviceScaleFactor`, `isMobile`, `hasTouch`, `colorScheme`, `geolocation`, `permissions`, `ignoreHTTPSErrors`, `bypassCSP`, `offline`, `launchOptions`, `proxy`. — [From Playwright](https://e2e.tester.army/docs/migrate/playwright)

**Parallelism**
- `workers` defaults to "half your cores" locally and `1` in CI (CI also sets `retries` 1, cache `read-only`, rejects `.only`, ignores `reuseExisting`). — [CI](https://e2e.tester.army/docs/ci)
- `fullyParallel` is "not yet; a file's tests run in order on one worker, files run in parallel". `describe.configure({ mode: 'parallel' })` is also not yet. `--shard`, `--repeat-each`, `--last-failed` and `--max-failures` exist. — [From Playwright](https://e2e.tester.army/docs/migrate/playwright)

**Network mocking, dialogs, downloads, iframes, evaluate, cookies**
- `browser.route('**/api/quote', async (route) => { await route.fulfill({ json: { cents: 4200 } }); })`. Register it before the page opens. Each handler calls exactly one of `fulfill`, `continue`, `fallback`, `abort`. Use `browser.waitForResponse('**/api/orders')` for real responses. — [Working with the browser](https://e2e.tester.army/docs/browser)
- Missing: `route.fetch()`, `abort(code)`, `routeFromHAR()`, `routeWebSocket()`, `waitForRequest()`, `page.on('console')`, `page.on('pageerror')`. — [From Playwright](https://e2e.tester.army/docs/migrate/playwright)
- Dialogs: "An unhandled `alert`, `confirm`, or `prompt` fails the next step." Use `const off = await browser.onDialog('accept')`. — [Working with the browser](https://e2e.tester.army/docs/browser)
- Downloads: `browser.waitForDownload(() => screen.getByRole('link', 'Export CSV').tap())` registers a `download` artifact. — [Working with the browser](https://e2e.tester.army/docs/browser)
- Iframes: `browser.frameLocator('#payment-frame').getByLabel('Card number').fill(...)`, nested `frameLocator`, and `locator` with CSS or XPath inside frames. — [Working with the browser](https://e2e.tester.army/docs/browser)
- Shadow DOM: `screen` queries reach open and closed shadow roots. `browser.locator`, `frameLocator` and `filter({ hasText })` stop at closed roots. — [Working with the browser](https://e2e.tester.army/docs/browser)
- `browser.evaluate` takes JSON in and out only, with no handles. Init scripts: `web({ initScripts: [{ path: 'tests/init.js' }] })` or `browser.addInitScript(...)`. Cookies: `browser.setCookies`, `browser.cookies()`. — [Working with the browser](https://e2e.tester.army/docs/browser)

**Tabs / popups**
- "`browser` is the whole browser, showing one active tab... A tab the app opens itself, from a `target="_blank"` link or `window.open`, is not followed: the active tab stays the one the attempt opened, so assert on what that tab shows, or open the link's URL with `browser.goto`." — [Browser reference](https://e2e.tester.army/docs/reference/web)
- "`page.waitForEvent('popup')`, `context.on('page')` | not yet; a window the app opens is not driven". — [From Playwright](https://e2e.tester.army/docs/migrate/playwright). In the Selenium guide: "`switchTo().window()` | No equivalent. Popups are unsupported". — [From Selenium](https://e2e.tester.army/docs/migrate/selenium)

**Attaching to an existing/remote browser (CDP)**
- "`connect` attaches to a remote Chromium over CDP instead of launching one; a browser provider does the same and also leases and releases the browser." — [Working with the browser](https://e2e.tester.army/docs/browser)
- `interface WebConnectOptions { cdpEndpoint(signal: AbortSignal): string | Promise<string>; reconnectEndpoint?(signal: AbortSignal): string | Promise<string>; }`. "`connect` needs chromium; `cdpEndpoint(signal)` is called once per worker and again at an attempt start after a disconnect." — [Browser reference](https://e2e.tester.army/docs/reference/web)
- In `reconnectEndpoint` (persistent) mode: "`cdpEndpoint` provisions a fresh, dedicated browser at every attempt start, including retries. The engine rejects a browser reused by a previous attempt. The remote must have only its default context, and the host must delete the browser when the attempt ends." This mode does not support `headers`, `basicAuth`, `userAgent`, `locale`, `timezoneId`, `app.clearState`, or session capture and restore. "The attempt's first page is the browser's own first tab, navigated to `about:blank`". — [Browser reference](https://e2e.tester.army/docs/reference/web)
- Without `reconnectEndpoint`, the engine keeps "ordinary isolated contexts". Every attempt starts in a fresh context. — [Browser reference](https://e2e.tester.army/docs/reference/web); [From Playwright](https://e2e.tester.army/docs/migrate/playwright)
- `goto` "throws `POLICY_DENIED` for a URL whose scheme is not `http:` or `https:` (`about:blank` is admitted)". — [Browser reference](https://e2e.tester.army/docs/reference/web)
- Desktop is mentioned in only three places: "Use it [the engine contract] to support a desktop app, a TV, or another platform" ([Writing an engine](https://e2e.tester.army/docs/writing-an-engine)); `SemanticNode.testId` is "an automation id on a desktop", and `EngineSnapshot.location` can be "the front window on a desktop" ([e2e/engine reference](https://e2e.tester.army/docs/reference/engine)). A grep of the full docs for Electron, Tauri and WebView found no hits.
- For context, Playwright's own docs connect to WebView2 by setting `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`, then `chromium.connectOverCDP('http://localhost:9222')`, then using `browser.contexts()[0]` and `context.pages()[0]`. They also warn that WebView2 instances share a user data dir by default (set `WEBVIEW2_USER_DATA_FOLDER` per test). WebView2 is available on Windows 10 and 11. — [Playwright WebView2](https://playwright.dev/docs/webview2)

### Inferences
- (Inference) A Tauri app on Windows uses WebView2, which can expose CDP, so `web({ connect: { cdpEndpoint } })` is in principle a route to drive the Tauri UI with e2e. Two caveats:
  - Default (non-persistent) mode makes a new Playwright context per attempt. In a WebView2 that likely does not render inside the app window, since Playwright's WebView2 recipe uses `contexts()[0]`.
  - Persistent mode (`reconnectEndpoint`) uses the default context but needs a freshly launched, dedicated browser per attempt. The `cdpEndpoint` resolver would have to relaunch the Tauri app every attempt. The first tab is also navigated to `about:blank`, and `app.open` then needs an http(s) app URL (Tauri v2 on Windows serves from `http://tauri.localhost` by default; unverified here). Feasible but untested; nothing in the docs supports it.
- (Inference) macOS Tauri (WKWebView) and Linux Tauri (WebKitGTK) have no CDP, so the web engine cannot attach. Only a custom engine (accessibility or vision-based) would work there.
- (Inference) The runner on Windows must run in WSL. A WebView2 CDP port on the Windows host must be reachable from WSL (for example via WSL2 mirrored networking). This adds setup friction for a Windows desktop target.
- (Inference) The practical path for a Tauri app whose UI is a web frontend is to test the web build in the web engine, and accept that desktop-only features (tray, updater, native toasts, `central://` deep links) stay uncovered unless a custom engine is written.

### Gaps
- No doc states whether `connect` works against WebView2 or Electron, or whether `newContext` is required in non-persistent mode against such an endpoint. This would need a spike.
- No statement on multi-window or multi-tab support plans beyond "not yet".

## Mobile engine (agent-device): simulators, emulators, real phones, requirements, app install, locators, frameworks, Android tablets

### Takeaway
`@e2e-dev/mobile` wraps Callstack's agent-device (bundled, no separate install). It drives iOS simulators, Android emulators and USB-connected iOS and Android phones through the accessibility tree:
- Locators: `getByTestId` reads the iOS accessibility identifier or the Android resource id.
- Builds: you supply `.app` or `.apk` builds. The engine "installs nothing on its own"; you call `device.installApp()` or install in CI with `simctl`/`adb`.
- Not available on devices: no URL navigation, no `test.setup` sessions, and no `selectOption`, `setInputFiles`, `scrollIntoView` or `secondaryTap`.
- Example projects cover React Native/Expo, SwiftUI, Jetpack Compose, Kotlin/Compose Multiplatform and Flutter.

### Cited Findings
**Basis and requirements**
- "`@e2e-dev/mobile` runs tests on iOS simulators, Android emulators, and phones connected to your machine. It is built on agent-device." — [Mobile](https://e2e.tester.army/docs/mobile)
- "The package includes a compatible version of `agent-device`; no separate installation is needed." iOS needs Xcode and a simulator. Android needs the Android SDK and an emulator. — [Mobile reference](https://e2e.tester.army/docs/reference/mobile)
- Check setup with `npx agent-device doctor`. "The wizard selects iOS on macOS and Android elsewhere." — [Mobile](https://e2e.tester.army/docs/mobile)

**Config and app install**
- Starter config: `targets: [{ name: 'ios', engine: mobile({ platform: 'ios' }), app: { bundleId: 'Settings' } }], workers: 1`. — [Mobile](https://e2e.tester.army/docs/mobile)
- Pointing at a build:
  ```ts
  app: { bundleId: 'com.example.app', appPath: './build/MyApp.app' }
  ```
  "The engine installs nothing on its own: `app.appPath` names the build, and the suite installs it... once per device, with `device.installApp()`... Use an `.app` bundle for iOS or an `.apk` for Android." — [Mobile](https://e2e.tester.army/docs/mobile)
- `app.launchArguments` (iOS process args; Android `am start` args, e.g. `['--ez', 'e2e', 'true']`). `app.permissions: { camera: 'grant', notifications: 'deny', location: 'reset' }` are set before each fresh launch. — [Mobile](https://e2e.tester.army/docs/mobile); [Mobile reference](https://e2e.tester.army/docs/reference/mobile)
- Expo dev builds: launch args `--initialUrl http://localhost:8081`, `-EXDevMenuShowsAtLaunch NO`, etc., plus `app.command: npx expo start --port 8081` and `readyUrl`. "expo-dev-launcher on Android does not read `--initialUrl`" (use `device.openLink` with the `exp+<slug>://expo-development-client/?url=...` link). — [Mobile](https://e2e.tester.army/docs/mobile)
- "`app.url` (not supported yet)" on a device target is `INVALID_CONFIG`. `app.open()` takes no path. Deep and web links go through `device.openLink`. — [Mobile reference](https://e2e.tester.army/docs/reference/mobile)

**Devices, pools, parallelism**
- `mobile({ platform: 'ios', device: ['iPhone 17', 'iPhone 17 Pro'] })` is a pool. Set `workers` ≥ pool size. "Without `device`, the engine uses booted devices up to the worker limit. If none are booted, it boots one. Two workers never drive the same device." — [Mobile](https://e2e.tester.army/docs/mobile)
- `MobileOptions`: `platform`, `device` (name, simulator UDID, `emulator-5554` serial, phone name, list, or `DeviceProvider`), `session`, `snapshot: 'full' | 'interactive'`, `settle` (default 150 ms), `transition` (default 500 ms), `videoTouches`. — [Mobile reference](https://e2e.tester.army/docs/reference/mobile)
- Devices boot in `prepare`, "before the run's clock starts, so a cold boot on CI is never charged against `launchTimeout`". — [Mobile reference](https://e2e.tester.army/docs/reference/mobile)

**Physical devices (incl. Android over adb)**
- "agent-device drives a phone plugged into your machine the same way it drives a simulator, so a physical device needs no other engine or option." List devices with `npx agent-device devices --platform ios`. Configure with `mobile({ platform: 'ios', device: 'QA iPhone' })`. — [Mobile](https://e2e.tester.army/docs/mobile)
- "Name a phone by its name, not its id. The engine reads a `device` string as an id only when it is a simulator UDID or an `emulator-<port>` serial, so a phone's UDID or adb serial is looked up as a name and not found... give each phone a unique name." — [Mobile](https://e2e.tester.army/docs/mobile)
- Android phone setup: "USB debugging is on and the phone is authorized, listed as `device` in `adb devices`. `app.appPath` is the same `.apk`." iOS phone setup: paired, trusted, unlocked, Developer Mode on, with `AGENT_DEVICE_IOS_TEAM_ID` and `AGENT_DEVICE_IOS_BUNDLE_ID` set for signing the XCTest runner. — [Mobile](https://e2e.tester.army/docs/mobile)
- Physical-device limits:
  - iPhone: every device setting is simulator-only (permissions, `clearState`, network, location, appearance, biometrics, keychain, clipboard).
  - Android phone: `device.setLocation` is emulator-only. Fingerprint works only where the phone exposes `cmd fingerprint`.
  - Networking: "`localhost` in the app is the phone itself... on Android forward the port with `adb reverse tcp:<port> tcp:<port>`."
  — [Mobile](https://e2e.tester.army/docs/mobile)

**Locators on native**
- "`screen` maps native controls to common roles such as `button`, `textbox`, `listitem`, and `switch`. Use `getByTestId` for native element identifiers." — [Mobile](https://e2e.tester.army/docs/mobile)
- Test ids by framework:

  | Framework | How the id is set |
  | - | - |
  | React Native | `testID` |
  | SwiftUI | `.accessibilityIdentifier()` |
  | Jetpack Compose and Compose Multiplatform | `Modifier.testTag()`, which needs `Modifier.semantics { testTagsAsResourceId = true }` on Android |
  | Flutter | `Semantics(identifier:)`, wrapped in `MergeSemantics` for buttons |

  — [Mobile](https://e2e.tester.army/docs/mobile)
- `device.locator('role=NavigationBar id=About')` accepts agent-device selector terms (`id`, `role`, `text`, `label`, `value`, `appname`, `windowtitle`, and flags `visible`, `hidden`, `editable`, `selected`, `focused`, `enabled`, `hittable`). — [Mobile reference](https://e2e.tester.army/docs/reference/mobile)
- Role mapping details: Android `rect` is in physical pixels ("display density... is not applied yet"). Android system bars are filtered out. Secure nodes are painted black in screenshots. — [Mobile reference](https://e2e.tester.army/docs/reference/mobile)
- Supported device actions: `tap`, `doubleTap`, `longPress`, `fill`, `clear`, `hover`, `check`, `uncheck`, `press` (`Enter` or one character), `swipe`, `dragTo`, `focus`. Point actions are also available (`screen.tapAt`, `swipe({from,to})`). "`selectOption`, `setInputFiles`, `scrollIntoView`, `secondaryTap`, and `modifiers` on `tap` or `doubleTap` are unsupported on devices." — [Mobile reference](https://e2e.tester.army/docs/reference/mobile); [Mobile](https://e2e.tester.army/docs/mobile)

**`device` fixture and agent tools**
- `device` methods: `setNetwork`, `setAirplaneMode`, `setPermission`, `setLocation`, `clearLocation`, `setAppearance`, `setOrientation`, `fold`, `setBiometrics`, `enrollBiometrics`, `installApp`, `openApp`, `openLink`, `closeApp`, `clearKeychain`, `foregroundApp`, `home`, `back`, `alert`, `dismissKeyboard`, `clipboard`, `setClipboard`. — [Mobile reference](https://e2e.tester.army/docs/reference/mobile)
- `mobileTools(iphone, pixel)` from `@e2e-dev/mobile/tools` adds `open_app`, `swipe` and `alert` agent tools. These are "gaps" in replay. — [Mobile](https://e2e.tester.army/docs/mobile)

**What differs from web**
- No app URL and no `navigate`. "`test.setup` saves a session... Not available. A simulator has no portable session snapshot; sign in per test or seed the app". `--video` writes an MP4 with taps shown. The cache anchors on `<bundle id> / <screen title>`. — [Mobile](https://e2e.tester.army/docs/mobile)
- Known limits:
  - `placeholder` is the only attribute a device node has.
  - A React Native tab on iOS has role `other`.
  - A plain React Native `View` on iOS has no children in the tree.
  - Compose clickables smaller than 48dp break taps.
  - `doubleTap` on iOS is two taps about 285 ms apart.
  — [Mobile](https://e2e.tester.army/docs/mobile)
- Troubleshooting: a wedged iOS runner reports `APP_UNREACHABLE`; recover with `npx agent-device daemon stop` and a simulator reboot. "agent-device 0.21.18 cannot parse the manifest of an APK built with aapt2" and falls back to SDK `aapt` (set `ANDROID_HOME`). — [Mobile](https://e2e.tester.army/docs/mobile)

### Inferences
- (Inference) An Android tablet over adb should work like an Android phone. Nothing in the docs is phone-specific beyond wording, and agent-device addresses any authorized `adb devices` entry. It must be named by its device name, since adb serials are not treated as ids. Two identical tablets need unique names.
- (Inference) Any native Android app (Views or Compose) works if its controls expose accessibility info or resource ids. Apps that draw custom canvases would need the vision tools (`tap_at`).
- (Inference) For a POS-style tablet app, no `test.setup` sessions means each test must sign in or seed state. A test-mode login via `app.launchArguments` is the natural lever.

### Gaps
- No explicit statement about Android tablets, Android TV or iPad layouts (iPad is mentioned only for keyboard dismiss behaviour).
- No statement on mobile web (Safari or Chrome on a device) beyond `device.openLink` with web links. `app.url` on device targets is "not supported yet".

## API testing: fetch + matchers in the same run

### Takeaway
API tests are ordinary e2e tests that call `fetch` against `app.baseUrl` and use value matchers, including `toMatchSchema` with any Standard Schema. They run in the same files and the same run as UI tests, with no model calls unless `agent` is used.

### Cited Findings
- "API tests run in the same files and the same run as UI tests. A test that takes only `app` calls no model." Example:
  ```ts
  const response = await fetch(new URL('/api/users', app.baseUrl));
  expect(response.status).toBe(200);
  const users = expect(await response.json()).toMatchSchema(z.array(User));
  ```
  `toMatchSchema` takes any Standard Schema (Zod, Valibot, ArkType) and returns the typed value. — [API](https://e2e.tester.army/docs/api-testing)
- `app.baseUrl` includes a run-allocated port. `expect.poll` handles eventually-consistent state. — [API](https://e2e.tester.army/docs/api-testing)
- Signed-in requests: write a `test.extend` fixture that sends `browser.cookies()` as a `cookie` header. This requires a web target. — [API](https://e2e.tester.army/docs/api-testing)
- "On a web target, an API test still opens a browser context. A target without an engine opens nothing, but it has no `app.baseUrl`... `e2e init` sets up such a target when you choose **None** at the engine prompt." — [API](https://e2e.tester.army/docs/api-testing)
- Playwright's `request` fixture maps to "Node `fetch`" (by design). — [From Playwright](https://e2e.tester.army/docs/migrate/playwright)

### Inferences
- (Inference) There is no dedicated HTTP client or API reporter. API coverage is plain Node, which is simple but offers no request-level tracing in reports beyond assertion failures.

### Gaps
- No docs on GraphQL, websocket or contract-testing helpers.

## Signing in: sessions, setup tests, secrets and redaction

### Takeaway
Sign in once in a `test.setup` that declares `sessions: [...]` and calls `session.save(name)`. Tests opt in with `{ session: name }`. Sessions are browser-only (cookies, localStorage, IndexedDB), encrypted, and live for one run only. Credentials and secrets are declared in config and overridable via `E2E_USER_*` / `E2E_SECRET_*`. Passwords are opaque `Secret` handles the model never sees, and their values are redacted from reports.

### Cited Findings
- Setup pattern: `test.setup('authenticate as admin', { sessions: ['admin'] }, async ({ app, screen, session, browser }) => { ... await session.save('admin'); })`, then `test('...', { session: 'admin' }, ...)`. "The runner runs the required setup even when you select only `tests/dashboard.e2e.ts`." — [Signing in](https://e2e.tester.army/docs/authentication)
- Rules:
  - Setup tests are top-level only.
  - Exactly one setup per session name.
  - A setup that does not save its declared name, or saves an undeclared one, is a `SESSION_CONTRACT` failure.
  - "a hosted browser leased per attempt has none".
  - A failed setup skips its dependents with cause `setup-failed`.
  — [Signing in](https://e2e.tester.army/docs/authentication)
- "On a browser target, a session holds cookies, local storage, and IndexedDB. It does not include server or database state... Sessions last for one run. They are encrypted on disk with a key that lives only in runner memory, and deleted during cleanup." The file is AES-256-GCM encrypted, so "there is no `.auth/user.json` to cache across runs". — [Signing in](https://e2e.tester.army/docs/authentication); [From Playwright](https://e2e.tester.army/docs/migrate/playwright)
- Credentials:
  ```ts
  credentials: { admin: { username: 'admin@example.test', password: process.env.ADMIN_PASSWORD ?? '' } }
  ```
  Per-run overrides: `E2E_USER_ADMIN_USERNAME`, `E2E_USER_ADMIN_PASSWORD`. `password` may be a function (for example a vault read), "called on every authorized fill and nowhere else". — [Signing in](https://e2e.tester.army/docs/authentication)
- `credentials.user('admin').password` is a `Secret` "with no plaintext accessor". The secret sinks are `locator.fill(secret)`, `agent.act(..., { params: { password } })` and engine options such as `basicAuth`. Non-password secrets go under `secrets: { 'stripe-key': ... }`, with the per-run override `E2E_SECRET_STRIPE_KEY`, and are retrieved with `secrets.get('stripe-key')`. — [Signing in](https://e2e.tester.army/docs/authentication)
- "Known values become `<secret:name>` in observations and reports." "After a secret fill, screenshots are withheld for the rest of the attempt". "Redaction matches full values and their encoded forms. A transformed value, such as the last four characters of a key, can still appear." — [Signing in](https://e2e.tester.army/docs/authentication)
- Personas: save one session per user, then `describe(..., { agent: persona, session: persona })`. — [Signing in](https://e2e.tester.army/docs/authentication)
- Devices: no `test.setup` or `session:`. "sign in per test or seed the app". — [Mobile](https://e2e.tester.army/docs/mobile)
- smol `scope: 'attempt'` replaces sessions with a `prepare(cdpEndpoint)` sign-in that runs once per warm browser and is then branched copy-on-write. — [smol machines browsers](https://e2e.tester.army/docs/integrations/smol)

### Inferences
- (Inference) Because sessions never persist across runs, every CI run pays one sign-in per session per target. That is cheap for deterministic logins, but an `agent.act` login inside setup would cost model calls each run unless the cache replays it.

### Gaps
- No OAuth or SSO helper (only form fill, basic auth or headers). TOTP is only hinted at ("a freshly computed one-time code" via the password function).

## Visual comparison

### Takeaway
`expect(screen).toHaveScreenshot('name.png')` and `expect(locator).toHaveScreenshot()` work on web, iOS and Android. Baselines are PNGs committed next to the test, one per target and OS. Tolerances follow Playwright's names. CI never writes baselines unless run with `--update-snapshots`.

### Cited Findings
- "`toHaveScreenshot` compares what the app shows against a PNG stored next to the test file. It works on every engine that captures pixels, so one test checks a browser, an iOS simulator, and an Android emulator." — [Visual comparison](https://e2e.tester.army/docs/visual-testing)
- Storage: `tests/checkout.e2e.ts-snapshots/checkout-web-linux.png`, `checkout-ios-darwin.png`. "Each target and operating system keeps its own file". "The first run has nothing to compare against: it writes the screenshot and fails." Rewrite with `npx e2e run --update-snapshots`. — [Visual comparison](https://e2e.tester.army/docs/visual-testing)
- CI: baselines "must come from the machine that renders them in CI: a Linux runner for the web and an Android emulator, a macOS runner with the same simulator for iOS". A CI run never writes into the project, and a missing screenshot fails the test and is placed at `snapshots/<path>` in results. The docs provide a `workflow_dispatch` workflow that runs `npx e2e run --update-snapshots` and uploads `tests/**/*-snapshots/`. — [Visual comparison](https://e2e.tester.army/docs/visual-testing)
- Options:

  | Option | Default |
  | - | - |
  | `threshold` | `0.2` |
  | `maxDiffPixels` | `0` |
  | `maxDiffPixelRatio` | `0` |
  | `mask` | none |
  | `maskColor` | `#ff00ff` |
  | `timeout` | `assertionTimeout` (5 s) |

  On failure the runner writes `-diff`, `-actual` and `-expected` images. — [Visual comparison](https://e2e.tester.army/docs/visual-testing)
- "On the web, animations are stopped and the text caret is hidden. On iOS and Android, the status bar is held in a fixed state". Secure fields are masked, and after a secret fill the matcher fails with `POLICY_DENIED`. — [Visual comparison](https://e2e.tester.army/docs/visual-testing)
- Not yet supported: `fullPage`, `clip`, `animations`, `caret`, `scale`, `stylePath`, `toMatchSnapshot`, `toMatchAriaSnapshot`, `locator.screenshot()`. — [From Playwright](https://e2e.tester.army/docs/migrate/playwright)

### Inferences
- (Inference) Viewport-only screenshots (no full page) limit visual regression on long pages to above-the-fold content or element-level shots.

### Gaps
- No hosted visual-review service or approval UI. Review happens through git diffs of PNGs.

## CI: GitHub Actions, secrets, replay cache, reports, PR comments, EAS/Bitrise/Codemagic, run time and cost

### Takeaway
Any CI that runs Node works: install dependencies, start the app or device, then `npx e2e run --reporter list,junit`, and upload `.e2e/` always. Mobile needs a macOS job (iOS) and a Linux job with KVM (Android). Commit `.e2e/cache/` so `agent.act` steps replay without model calls. CI defaults the cache to `read-only`. Judgments (`assert`, `waitFor`, `extract`) always call the model. PR comments come from `@e2e-dev/github`.

### Cited Findings
**General**
- "A CI job does the same steps on each service: install the dependencies, start the app or a device, and run `npx e2e run`... A mobile job that boots its own device also needs a Mac (iOS) or a Linux machine with KVM (Android)... A hosted device service needs neither." — [CI](https://e2e.tester.army/docs/ci)
- Outputs: `.e2e/report.json`, `.e2e/junit.xml` with the `junit` reporter, and `.e2e/results/` (trace pages, screenshots, screen dumps, video with `--video`). "Upload `.e2e/` at the end of each job, also when a test fails." — [CI](https://e2e.tester.army/docs/ci)
- CI mode is enabled by the `CI` env var:

  | Setting | Local | CI |
  | - | - | - |
  | `retries` | `0` | `1` |
  | `workers` | half the cores | `1` |
  | `cache` (when unset) | `read-write` | `read-only` |
  | `.only` | allowed | `ONLY_IN_CI` |
  | `reuseExisting` | honored | ignored |

  Telemetry off: `E2E_TELEMETRY_DISABLED: '1'`. — [CI](https://e2e.tester.army/docs/ci)
- Sharding: `--shard ${{ matrix.shard }}/3`. "Combining the documents into one is not implemented yet." Reruns: `--last-failed` reads `report.json` (download it into `.e2e/` in CI first). `--max-failures <n>`. — [CI](https://e2e.tester.army/docs/ci)
- Mobile job rules:
  - One job per platform. "Hosted Macs use Apple Silicon, which cannot nest virtualization. The Android emulator does not start on them."
  - Pin the iOS runtime (`com.apple.CoreSimulator.SimRuntime.iOS-26-5`).
  - Cache `~/.agent-device`, where the XCUITest runner compiles on first use.
  - Use Release builds: "A React Native or Expo debug build loads its JavaScript from Metro... opens on an error screen".
  - Node 24.8+ or 22.22.3+.
  — [CI](https://e2e.tester.army/docs/ci)

**Model credentials and security**
- Pass the provider key (for example `AI_GATEWAY_API_KEY`) as a CI secret. "Tests that never use `agent` need no model credentials." "Run untrusted code with no secrets and no write tokens." — [CI](https://e2e.tester.army/docs/ci)

**Replay cache in CI**
- "`e2e init` adds `.e2e/cache/` to `.gitignore`... To share replays, remove that line and commit the directory. CI stays `read-only` unless you set `cache: 'read-write'`." Entries contain "no prompts, conversations, screenshots, observed trees, or secret values". "Upgrading `e2e` to a version that changes how entries are matched re-keys every entry". — [Caching](https://e2e.tester.army/docs/cache)
- `--strict-cache` (or `cache: { strict: true }`): "A step whose recording exists but no longer replays fails with `REPLAY_STALE` and makes no model call". — [Caching](https://e2e.tester.army/docs/cache)
- "The cache key includes `app`, so a recording from your simulator replays on the CI simulator." — [CI](https://e2e.tester.army/docs/ci)

**GitHub Actions (web)**
- Workflow steps:
  1. `actions/checkout`, `pnpm/action-setup`, `actions/setup-node` (node 26, pnpm cache), `pnpm install --frozen-lockfile`.
  2. `pnpm exec e2e-web install chromium --with-deps`.
  3. `npx e2e run --reporter list,junit` with env `APP_URL`, `AI_GATEWAY_API_KEY`, `E2E_USER_ADMIN_USERNAME`, `E2E_USER_ADMIN_PASSWORD`.
  4. Upload `.e2e/report.json` and `.e2e/junit.xml`, plus `.e2e/results` with `retention-days: 7`, under `if: ${{ !cancelled() }}`.

  Actions are pinned by SHA. `permissions: contents: read`. `concurrency` cancels in-progress PR runs. — [GitHub Actions](https://e2e.tester.army/docs/ci/github-actions)

**GitHub Actions (mobile)**
- iOS job on `macos-26`: `xcodebuild ... -configuration Release -sdk iphonesimulator`, `actions/cache` of `~/.agent-device`, `xcrun simctl create e2e "iPhone 17" com.apple.CoreSimulator.SimRuntime.iOS-26-5`, `bootstatus -b`, `install`, then `npx e2e run --target ios`.
- Android job on `ubuntu-latest`: enables KVM via a udev rule, `./gradlew :app:assembleRelease`, then `reactivecircus/android-emulator-runner` (api-level 36, x86_64, google_apis, pixel_7, `-no-window -gpu swiftshader_indirect ...`), with `adb install` and `npx e2e run --target android` in the same `script` because the action stops the emulator when the step ends. `timeout-minutes: 60`.
- Expo alternative: `npx expo run:ios --configuration Release --device generic --no-bundler --output build/ios`.
- The repo's own `mobile.yml` caches the Expo build per native fingerprint, boots two simulators for two workers, and reruns `--last-failed`.
— [GitHub Actions](https://e2e.tester.army/docs/ci/github-actions)

**PR comments (`@e2e-dev/github`)**
- Install with `npm install --save-dev @e2e-dev/github` and set `reporters: ['list', github()]`. The workflow needs `permissions: pull-requests: write` and `GITHUB_TOKEN: ${{ github.token }}` in the test step env. It posts one comment per run and updates it on reruns (including `npx e2e run || npx e2e run --last-failed`). It also writes the job summary. — [Pull request comments](https://e2e.tester.army/docs/github)
- The comment shows counts, agent usage (for example "9 agent steps · 4 replayed from cache · 31 model calls · 128k tokens (62% cached) · $0.31"), failures with source links and evidence links, collapsed flaky tests, and a full table. — [Pull request comments](https://e2e.tester.army/docs/github)
- Matrix jobs need `github({ key: process.env.MATRIX_BROWSER })`. Fork PRs get read-only tokens, so nothing is posted. The `markdown` reporter writes `.e2e/summary.md`. GHES uses `GITHUB_SERVER_URL` and `GITHUB_API_URL`. — [Pull request comments](https://e2e.tester.army/docs/github)

**EAS Workflows (CI service)**
- `eas.json` profile: `"e2e": { "withoutCredentials": true, "ios": { "simulator": true }, "android": { "buildType": "apk" } }`.
- Jobs: `type: build`, then custom jobs on `macos-medium` and `linux-medium-nested-virtualization`, using `eas/checkout`, `eas/install_node_modules`, `eas/download_build`, `eas/start_android_emulator` (`system-images;android-35;google_apis;x86_64`), and `eas/upload_artifact` under `if: ${{ always() }}`.
- Set `environment:` per job ("a custom job reads `production` by default") and `CI: '1'`.
- "EAS Workflows also has a built-in `maestro` job type... For e2e, use a custom job". A `fingerprint` job with `get-build` and `repack` avoids native rebuilds.
— [EAS Workflows](https://e2e.tester.army/docs/ci/eas-workflows)

**Bitrise**
- Pipeline `e2e` with workflows `e2e-ios` (stack `osx-xcode-26.6.x`) and `e2e-android` (stack `ubuntu-noble-24.04-bitrise-2025-android`).
- Steps: `xcode-build-for-simulator@3`, `xcode-start-simulator@0`, `avd-manager@2` (api 35), `android-build@1`, `wait-for-android-emulator@1`. Then zip `.e2e` into `$BITRISE_DEPLOY_DIR` (because `deploy-to-bitrise-io` uploads only the top level) and export results with `custom-test-results-export@1`.
- Secrets need "Expose for Pull Requests". "A build of a public app never gets a secret", so agent steps without recordings fail there.
— [Bitrise](https://e2e.tester.army/docs/ci/bitrise)

**Codemagic**
- `instance_type: mac_mini_m2` for iOS and `linux_x2` for Android, with the Ubuntu image AVDs `emulator` (API 34), `emulator-35` and `emulator-36`.
- `test_report: .e2e/junit.xml` and artifacts `.e2e/results/**`. The model key goes in env group `e2e`. "Linux instances need billing enabled."
— [Codemagic](https://e2e.tester.army/docs/ci/codemagic)

**Run time and cost hints**
- "`assert` and `extract` make one judgment, plus one repair call if the model's answer is malformed." "`waitFor` skips model calls while the screen is unchanged." "Screenshots add input tokens on every call that carries them." "The replay cache reruns passing `act` steps without model calls." — [How agent steps work](https://e2e.tester.army/docs/agent-steps)
- `--debug` prints a per-step table. The example shows model `anthropic/claude-sonnet-4.5`, total $0.0312 for one act (3 calls, $0.0198) plus one assert (1 call, $0.0114). — [Debugging a run](https://e2e.tester.army/docs/debugging)
- Hosted sessions are billed while they run: "keep `workers` at what the suite can fill". EAS sessions take "about three minutes from request to ready". — [Working with the browser](https://e2e.tester.army/docs/browser); [EAS Simulators](https://e2e.tester.army/docs/integrations/eas)
- `--max-failures <n>` keeps a broken deploy from spending a model call on each remaining agent step. — [CI](https://e2e.tester.army/docs/ci)

### Inferences
- (Inference) For a monorepo with several web apps (hub, store app), one config can hold multiple targets with different `app.url`/`app.command`. Each test runs on every target unless scoped, so separate configs (`--config`) per app are cleaner.
- (Inference) Committing the replay cache plus `--strict-cache` in CI is the documented way to keep CI costs near zero for `act` steps and to surface UI drift as failures instead of silent model spend.

### Gaps
- No published benchmark of typical suite durations or per-test cost beyond the examples above.
- Merging sharded reports is not implemented.

## Hosted integrations: Kernel, EAS Simulators, smol machines (and custom providers)

### Takeaway
There are three official provider packages, each plugging into an engine seam:
- `@e2e-dev/kernel`: hosted Chromium via `BrowserProvider`.
- `@e2e-dev/eas`: hosted iOS simulators and Android emulators via `DeviceProvider`, driving the agent-device daemon EAS runs.
- `@e2e-dev/smol`: local Chromium microVMs on macOS Apple Silicon or Linux KVM, with copy-on-write per-attempt branches.

Any other service is "a few dozen lines" implementing `acquire` and `release` (plus optional `record`, `downloads`, `sweep`).

### Cited Findings
**Kernel (`@e2e-dev/kernel`)**
- Install `@e2e-dev/kernel @onkernel/sdk`. Config: `engine: web({ browser: kernel() })`. Env: `KERNEL_API_KEY`. "By default each worker slot gets its own hosted Chromium... `scope: 'attempt'` leases one per test attempt". — [Kernel browsers](https://e2e.tester.army/docs/integrations/kernel)
- `kernel(options)` takes Kernel's create-browser body (`stealth`, `headless`, `timeout_seconds`, `profile`, `proxy`, `viewport`, `extensions`, `region`, `tags`...) plus `scope` and `replay`. Recordings are saved as `video/replay.mp4` (10 fps default, headed only). Downloads go to `/tmp/e2e-downloads` and are read back via Kernel's filesystem API. `timeout_seconds` defaults to 600. Browsers are tagged `e2e_run`, `e2e_target` and so on, and swept at run end. Attempt scope cannot use sessions, `headers`, `basicAuth`, `userAgent`, `locale`, `timezoneId` or `app.clearState()`. — [Kernel browsers](https://e2e.tester.army/docs/integrations/kernel)

**EAS Simulators (`@e2e-dev/eas`)**
- Config: `mobile({ platform: 'ios', device: easSimulators({ buildId: process.env.EAS_BUILD_ID }), videoTouches: false })`. "No Mac, Xcode, or Android SDK on the machine that runs e2e." "EAS Simulators is in limited access; check yours with `npx eas-cli@latest simulator:availability`." — [EAS Simulators](https://e2e.tester.army/docs/integrations/eas)
- Auth: `EXPO_TOKEN`, or the eas-cli login in `~/.expo/state.json`. The project id comes from `extra.eas.projectId` in the app config.
- Install options: `buildId` (EAS Build), `applicationArchiveUrl`, or a local `app.appPath` uploaded with `device.installApp()`.
- Other options: `device` (for example `'iPhone 17 Pro'` or `'pixel_9'`), `maxIdleTimeMinutes` (10), `maxDurationMinutes` (cap 40, or 115 on high priority), `agentDeviceVersion`, `tags`.
- Sessions take about 3 min to become ready, and "A run must fit in one session's lifetime".

— [EAS Simulators](https://e2e.tester.army/docs/integrations/eas)

**smol machines (`@e2e-dev/smol`)**
- "`smol()` from `@e2e-dev/smol` is a browser provider that runs Chromium in smol machines microVMs on your computer. Each worker slot boots one browser machine. By default, each test attempt runs in a copy-on-write branch of it, ready in about a second and deleted when the attempt ends." "smol machines run on macOS on Apple Silicon, or on Linux with KVM (`/dev/kvm`). They need no account or API key." Install: `@e2e-dev/smol smolmachines`. — [smol machines browsers](https://e2e.tester.army/docs/integrations/smol)
- Config: `web({ browser: smol({ hostPorts: [3000] }) })`. `hostPorts` maps host loopback ports into the VM ("isn't an allowlist"; the VM can reach any loopback port via `host.smolvm.internal`). `prepare: async (cdpEndpoint) => {...}` signs in once per warm browser. `app: { source, setup, start, port, env }` runs the app inside each VM, so "each attempt gets its own copy of the running app and its files, a database included". Defaults: `scope: 'attempt'`, `cpus` 2, `memoryMb` 2048. The back/forward cache is off. — [smol machines browsers](https://e2e.tester.army/docs/integrations/smol)

**Custom providers**
- `BrowserProvider { name; scope?: 'worker' | 'attempt'; acquire(request): Promise<BrowserLease>; release(lease, ctx); record?; downloads?; sweep? }`, where `BrowserLease { id; cdpEndpoint; reconnectEndpoint? }`. "A provider implies chromium (CDP attach is chromium-only) and cannot be combined with `connect`." — [Working with the browser](https://e2e.tester.army/docs/browser)
- `DeviceProvider { name; acquire; release; record? }`, where `DeviceLease { id; daemon?: { baseUrl; authToken? }; client?; device?; deviceId?; installedApp? }`. "any service that runs an agent-device daemon next to a simulator, an emulator, or a physical device works." The docs include an example using `createAgentDeviceClient` and `client.leases.allocate` for agent-device's own device-cloud runtimes. — [Mobile](https://e2e.tester.army/docs/mobile)

### Inferences
- (Inference) smol's per-attempt app copy (DB included) gives strong test isolation for stateful apps without a services API. On a Mac M-series dev box it is free. In CI it needs a Linux runner with KVM (the same requirement as the Android emulator).
- (Inference) No BrowserStack, Sauce Labs or Firebase Test Lab integration exists. Those would need a custom `DeviceProvider` that runs an agent-device daemon, which those farms do not provide out of the box.

### Gaps
- No pricing information for Kernel or EAS Simulators in the e2e docs.

## Migrations: coexistence with Playwright, Cypress, Selenium, Detox, Maestro

### Takeaway
Every guide recommends running both suites side by side and migrating one file or flow at a time. With Playwright, e2e brings its own pinned `playwright-core`, so the two coexist if file patterns are kept apart. Config is not reused: Playwright keys are rejected with pointers. Page objects port as fixtures that take `screen` and `browser`, since there is no raw `Page`. Many Playwright features are marked "not yet" (popups, HAR, `locator.locator`, `and`/`or`, `toHaveCSS`, HTML reporter, UI mode, `globalSetup`). Detox and Maestro users keep their builds and testIDs. Detox-specific synchronization is unnecessary.

### Cited Findings
**Playwright**
- "`@e2e-dev/web` brings its own pinned `playwright-core`, so your `@playwright/test` version is yours to keep. Both runners can stay in one project. e2e reads `e2e.config.ts` and finds `tests/**/*.e2e.ts` by default, so keep the two file patterns apart." — [From Playwright](https://e2e.tester.army/docs/migrate/playwright)
- "A Playwright key the runner recognizes (`testDir`, `baseURL`, `webServer`, `projects`) is rejected with a message naming where that fact lives here." — [From Playwright](https://e2e.tester.army/docs/migrate/playwright)
- Mapping highlights (Playwright → e2e):

  | Playwright | e2e |
  | - | - |
  | `use.baseURL` | `app: { url }` |
  | `webServer` | `app: { url, command }` (a `webServer` array is "missing") |
  | `projects` | `targets` |
  | `projects[].dependencies` for sign-in | `test.setup` + `{ session }` |
  | `use.storageState` | none (by design) |
  | `use.connectOptions` / `connectOverCDP` | `web({ connect })` |
  | `use.extraHTTPHeaders` | `web({ headers })` |
  | `page.goto` | `app.open` (or `browser.goto`) |
  | `click` | `tap` (`click` is an alias) |
  | `page.locator('css')` | `browser.locator('css')` (web only) |
  | `expect(page).toHaveURL` | `expect(browser).toHaveURL` |
  | `npx playwright test` | `npx e2e run` |
  | `--project` | `--target` |
  | `codegen` | `npx e2e explore` / `npx e2e mcp` |
  | `npx playwright install` | `npx @e2e-dev/web install` |

  — [From Playwright](https://e2e.tester.army/docs/migrate/playwright)
- Missing: `globalSetup`/`globalTeardown`, `fullyParallel`, HTML reporter (the `markdown` reporter and `trace.md` pages exist instead), `metadata`, `getByTitle`, `filter({ hasNot })`, `locator.and/or`, `locator.locator('css')`, `locator.evaluate`, `locator.screenshot`, `ariaSnapshot`, popups, console events, `routeFromHAR`, `expect.extend`, `test.step`, `test.info`, worker-scoped fixtures, `--ui`, `page.pause()`. — [From Playwright](https://e2e.tester.army/docs/migrate/playwright)
- By design:
  - String names are exact and case-sensitive (Playwright uses substring matching). Use `{ exact: false }` or a RegExp for fragments.
  - Text reads use `innerText`.
  - One match or `LOCATOR_AMBIGUOUS` (including `isVisible()`).
  - `browser.evaluate` is JSON-only.
  - Sessions are per run and encrypted.
  - No raw `Page` in tests ("Nothing on a raw page is recorded, redacted, or masked"). `surfaceOf(engine)` exists only for custom executors.
  — [From Playwright](https://e2e.tester.army/docs/migrate/playwright)
- Defaults that differ:

  | Setting | Playwright | e2e |
  | - | - | - |
  | Test timeout | 30 s | 120 s |
  | Action timeout | none | 30 s |
  | Retries | 0 | 1 in CI |
  | Trace | `off` | `retain-on-failure` |

  — [From Playwright](https://e2e.tester.army/docs/migrate/playwright)
- Page objects take `Screen`/`Locator` (from `e2e`) and `Browser` (from `@e2e-dev/web`) and are handed out via `base.extend<{ accountPage: AccountPage }>(...)`. "A fixture that reads `browser` makes every test on that `test` web only". — [From Playwright](https://e2e.tester.army/docs/migrate/playwright)

**Cypress**
- "Both suites can stay in the project while you migrate one spec at a time." `data-cy` → `web({ testIdAttribute: 'data-cy' })` + `getByTestId`. `start-server-and-test` → `app.command`. `cy.intercept` → `browser.route`. `cy.session` → `test.setup`. `cy.task/exec/request` → Node code. "Component testing | No equivalent". — [From Cypress](https://e2e.tester.army/docs/migrate/cypress)

**Selenium**
- "A Java or Python suite needs to be rewritten. Run both suites while you move one flow at a time." Selenium Grid → `workers`, `connect` over CDP, or a browser provider. `By.id` → `browser.locator('#x')` or `testIdAttribute: 'id'`. "`switchTo().window()` | No equivalent. Popups are unsupported". — [From Selenium](https://e2e.tester.army/docs/migrate/selenium)

**Detox**
- "`@e2e-dev/mobile` drives a simulator or emulator using your normal debug or release build. It does not need the Detox framework. React Native `testID` props work with `getByTestId` on both platforms." "You can use the same simulator for each runner while migrating one spec at a time." — [From Detox](https://e2e.tester.army/docs/migrate/detox)
- Mapping:
  - `binaryPath` → `app.appPath` + `device.installApp()`
  - `by.id` → `getByTestId`; `by.type('RCTImageView')` → `device.locator('role=Image')`
  - `waitFor(...).whileElement(...).scroll` → `screen.scrollUntilVisible`
  - `device.launchApp({ newInstance: true })` → `app.restart()`; `({ delete: true })` → `app.clearState()`
  - `device.reloadReactNative()`, `setStatusBar`, `setURLBlacklist`, `disableSynchronization()` have no equivalent ("e2e waits through actions and retrying assertions").
  - Swipe direction semantics are inverted (Detox names the finger's direction, e2e the content's).
  — [From Detox](https://e2e.tester.army/docs/migrate/detox)

**Maestro**
- "Both runners can use the same simulator or emulator." Each command is mapped with a status (`same`, `renamed`, `device only`, `by design`, `missing`):
  - Renamed: `tapOn` → `screen.getByText(...).tap()`; `assertScreenshot` → `toHaveScreenshot`; `assertWithAI` → `agent.assert`; `extractTextWithAI` → `agent.extract`; `runFlow` → functions or fixtures; `http.get` → `fetch`; `--shards` → device pool + `workers` or `--shard`.
  - Missing: `addMedia`, lock/power/volume/TV keys, `label`, `assertDarkMode`, JUnit `properties`, HTML report, Maestro Studio, `maestro hierarchy`.
  - By design: spatial selectors (`below`/`above`/`leftOf`/`rightOf`) have no port; Maestro Cloud → "your CI".
  — [From Maestro](https://e2e.tester.army/docs/migrate/maestro)
- Maestro text and id selectors are regexes. e2e `getByText` is exact. Maestro taps the first match silently; e2e fails with `LOCATOR_AMBIGUOUS`. — [From Maestro](https://e2e.tester.army/docs/migrate/maestro)

### Inferences
- (Inference) Existing Playwright fixtures and helpers that use `page` directly cannot be reused unchanged. Anything relying on `page.*` APIs outside the mapped surface (popups, HAR, console listeners, `locator.evaluate`) must stay in Playwright. The guides themselves suggest keeping stable Playwright tests where they are.
- (Inference) For a team already on Playwright, the cheapest adoption is additive: put new agentic flows in `tests/**/*.e2e.ts`, keep `*.spec.ts` in Playwright, and run both in CI.

### Gaps
- No automated migration tool beyond a "migration prompt" for coding agents (`<SetupPrompt>` on each guide; prompt text not in the dump).

## Writing an engine: the contract and how hard a Tauri or Windows desktop engine would be

### Takeaway
Engines implement `defineEngine({...})` from `e2e/engine` with `spiVersion: 1`. The runner owns polling, retries, assertions, agent planning, secrets and cache. The engine supplies one immediate snapshot (`observe` → `SemanticNode` tree with stable ids, roles, names, `testId`, rects), `locate` (via the exported `resolveExpression`), `perform` for a declared closed set of action kinds, optional `performAt` for vision-only surfaces, a keyboard, `session` hooks (open/back/restart/reset), optional `state` for sessions, artifacts, fixtures, and lifecycle hooks. The contract explicitly anticipates desktop apps ("automation id on a desktop", "the front window on a desktop"), but no desktop engine ships.

### Cited Findings
- "An engine connects `screen`, `app`, and agent calls to a UI platform through the `e2e/engine` contract. Use it to support a desktop app, a TV, or another platform. The existing `@e2e-dev/web` and `@e2e-dev/mobile` packages use the same public `defineEngine` API." — [Writing an engine](https://e2e.tester.army/docs/writing-an-engine)
- Ownership: the runner owns collection, targets, retries, hooks, sessions, "Query polling and strict single-match cardinality", assertion polling, agent planning, tool authorization, secret resolution and redaction. The engine owns "One immediate query, one node read", "One node's actionability and input dispatch", "Process, page, and device mechanics", and "Source masking of secure observations". — [Writing an engine](https://e2e.tester.army/docs/writing-an-engine)
- Skeleton (abridged from docs):
  ```ts
  import { ConfigurationError, defineEngine, resolveExpression, type EngineHandle } from 'e2e/engine';
  return defineEngine({
    name: 'hyperdrive', version: '1.0.0', spiVersion: 1, platform: 'ios',
    validateApp(app, { targetName }) { /* throw ConfigurationError('INVALID_CONFIG', ...) */ },
    async init(info) { await client.boot(); },
    async dispose(context) { await client.shutdown({ signal: context.signal }); },
    async observe() { return { location, root: { ref: { id: 'root', revision: '' }, role: 'window', children }, viewport }; },
    async locate(expression) { return resolveExpression(expression, (await client.snapshot()).nodes); },
    actions: ['tap', 'fill', 'swipe'],
    async perform(ref, action) { /* switch on action.kind */ },
    session: { async back() {...}, async restart() {...} },
  });
  ```
  — [Writing an engine](https://e2e.tester.army/docs/writing-an-engine)
- Capability table:

  | Member | Unlocks |
  | - | - |
  | `observe` | agent and replay cache |
  | `perform` + `actions` | node actions |
  | `locate` | `screen`, `Locator`, `expect(locator)` |
  | `validateApp` | config check of the target's `app` |
  | `session.{open, back, restart, reset}` | `app.open()`, `app.back()`, `app.restart()`, `app.clearState()` |

  Pointer, keyboard, state, artifacts and fixtures are separate optional capabilities. "Calls to unsupported capabilities fail with `UNSUPPORTED_CAPABILITY`." — [Writing an engine](https://e2e.tester.army/docs/writing-an-engine)
- Closed action grammar `LOCATOR_ACTION_KINDS`: `tap`, `doubleTap`, `secondaryTap`, `longPress`, `fill`, `clear`, `press`, `check`, `uncheck`, `focus`, `hover`, `scrollIntoView`, `selectOption`, `setInputFiles`, `dragTo`, `swipe`. "The grammar is closed. Anything beyond it is an agent-side `defineTool`." `POINTER_ACTION_KINDS`: `tap`, `doubleTap`, `secondaryTap`, `longPress`, `hover`, `dragTo`, `swipe`, `swipeTo`. — [e2e/engine reference](https://e2e.tester.army/docs/reference/engine)
- Lifecycle order: `prepare` (once per target in the runner; install runtimes) → `init` (per worker; boot devices) → `startAttempt` → `settleAttempt` → `endAttempt` (idempotent) → `dispose` → `finish`. The engine may declare a `workers` cap. — [Writing an engine](https://e2e.tester.army/docs/writing-an-engine); [e2e/engine reference](https://e2e.tester.army/docs/reference/engine)
- Nodes: "Assign ids that stay unique for the UI's lifetime and keep the root id stable... throw `NODE_STALE` if the node no longer exists... Limit snapshot size... Set `truncated`... Put test identifiers in `testId`, whether they come from a document attribute, an iOS accessibility identifier, an Android resource id, or a desktop automation id." — [Writing an engine](https://e2e.tester.army/docs/writing-an-engine)
- Vision-only surfaces: "For a UI without a semantic tree, return a childless `root` and `pixels` from `observe`. Implement `performAt` and declare the supported kinds in `pointerActions`... Coordinate actions replay only at the recorded viewport size". — [Writing an engine](https://e2e.tester.army/docs/writing-an-engine)
- Keyboard: "`keyboard.type` must deliver the text as a person typing would, through the platform's keyboard path... Inserting the value without keystrokes is not a compliant implementation." — [Writing an engine](https://e2e.tester.army/docs/writing-an-engine)
- Secrets: the engine receives `fill` with `sensitive: true` and must handle it securely or throw. State snapshots are credentials, encrypted by the runner. "`restore` must replace the app's entire persisted state". — [Writing an engine](https://e2e.tester.army/docs/writing-an-engine)
- Errors: throw `EngineError` codes. "Only `NODE_STALE` and `FRAME_NOT_FOUND` can be retryable. Use `ACTION_MAY_HAVE_COMMITTED`". — [Writing an engine](https://e2e.tester.army/docs/writing-an-engine)
- Engines can contribute fixtures (`context.fixture('device', {...})`) and ship tool packs via `defineTool` with `platforms` (for example `@e2e-dev/mobile/tools`). Verify against `engine-contract.test.ts` in the repo. — [Writing an engine](https://e2e.tester.army/docs/writing-an-engine)
- `defineEngine` validation: `spiVersion` must be `1`; `perform`, `locate`, `performAt` and `keyboard` require `observe`; `perform` requires `actions` and vice versa; an `app` member on the engine is rejected. — [e2e/engine reference](https://e2e.tester.army/docs/reference/engine)

### Inferences
- (Inference) Effort for a Windows desktop engine: moderate. A minimal useful engine needs:
  - a Node-callable UI Automation bridge (for example a small .NET or PowerShell sidecar, or an existing Node UIA binding) that snapshots the window tree into `SemanticNode`s (roles mapped from UIA ControlType, `testId` from AutomationId) and dispatches Invoke/Value/Toggle patterns or synthetic input;
  - `prepare`/`init` to launch the `.exe`;
  - `session.restart` to relaunch;
  - `artifacts.screenshot` for vision and visual comparison.

  The runner already provides polling, retries, agent loop, cache and reports. The hardest parts are stable node ids across snapshots, secure-field masking, and the runner itself needing WSL on Windows ("On Windows, run inside WSL"), which forces a cross-boundary bridge to Windows-side UIA.
- (Inference) For a Tauri app, an engine could wrap the WebView2 CDP endpoint (reusing Playwright `connectOverCDP` and `contexts()[0]`) for the in-app DOM, plus OS-level hooks for tray and notifications. Alternatively, a vision-only engine (childless root + `pixels` + `performAt`) is the lowest-effort generic fallback, but coordinate replays are viewport-size-bound.
- (Inference) tauri-driver/WebDriver is not part of e2e's world. Bridging it would also mean a custom engine.

### Gaps
- No third-party engines are listed in the docs. No published desktop engine (Electron, Tauri, WinUI, macOS AppKit) was found.
- Whether agent-device itself supports macOS desktop apps is not stated in the e2e docs (not checked).

## Example projects

### Takeaway
There are eight standalone examples in `tester-army/e2e/examples`: three web (Vite, Next.js, Astro), Expo (web + iOS + Android), and four native (SwiftUI, Jetpack Compose, Kotlin Multiplatform, Flutter). Each is a greeting app with three locator tests and two agent tests.

### Cited Findings
- "Each example is a standalone greeting app with three locator tests and two agent tests... The projects install published e2e packages from npm and work outside this repository." — [Example projects](https://e2e.tester.army/docs/example-projects)
- Examples:

  | Example | What it shows |
  | - | - |
  | `with-vite` | React + Vite, Chromium |
  | `with-next` | Next.js App Router; the runner starts the app |
  | `with-astro` | no UI framework; the runner starts the app |
  | `with-expo` | "Run the same tests on web, an iOS simulator, or an Android emulator" |
  | `with-swiftui` | iPhone simulator |
  | `with-compose` | Android emulator |
  | `with-kotlin-multiplatform` | emulator or simulator |
  | `with-flutter` | emulator or simulator |

  "The SwiftUI, Jetpack Compose, Kotlin Multiplatform, and Flutter projects keep them in an `e2e/` folder." "Locator tests need no model. Set `AI_GATEWAY_API_KEY` to run the agent tests; without it, those tests skip." — [Example projects](https://e2e.tester.army/docs/example-projects)

### Inferences
- (Inference) The Expo example shows one test file portable across web and native targets, using `screen`/`agent`/`expect` only, with `requires: ['browser']` or `requires: ['device']` gating platform-specific tests. This is a useful pattern for apps that share UI between web and mobile.

### Gaps
- No desktop (Electron or Tauri), Vue, Svelte or Angular examples are listed.
