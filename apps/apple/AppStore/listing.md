# ViewSwitcher for iPhone and iPad: App Store listing (MAC-19, PHONE-9)

Everything App Store Connect asks for, in the order it asks. Paste each block as it is. Limits are
Apple's; `bun apps/apple/AppStore/check.ts` checks them. The app record itself (bundle ID
`com.twowitstudios.viewswitcher`, $9.99) is MAC-21. One universal app: one purchase covers iPhone and iPad (PHONE-1).

## App Information

| field | value |
|---|---|
| Name (30) | `ViewSwitcher Remote` ("ViewSwitcher" is taken on the store; the home-screen name stays ViewSwitcher) |
| Subtitle (30) | `One-tap scene switcher for OBS` |
| Bundle ID | `com.twowitstudios.viewswitcher` |
| SKU | `viewswitcher-ipad` |
| Primary language | English (U.S.) |
| Primary category | Photo & Video |
| Secondary category | Productivity |
| Content rights | Yes: it contains, shows or accesses third-party content, and we have the necessary rights. (The demo's photos are Unsplash License, credited in apps/site/CREDITS.md; everything else it shows is the user's own scenes from their Mac.) |

### Age rating

Every question in the questionnaire is **None** or **No**:

| question | answer |
|---|---|
| Cartoon or fantasy violence, realistic violence, prolonged graphic or sadistic violence | None |
| Profanity or crude humor; mature or suggestive themes; horror or fear themes | None |
| Sexual content or nudity; graphic sexual content and nudity | None |
| Alcohol, tobacco or drug use or references; medical or treatment information | None |
| Simulated gambling; contests | None |
| Unrestricted web access | No (the app shows only the ViewSwitcher server on your Mac; other links open in Safari) |
| User-generated content, messaging or chat, advertising | No |
| Gambling, loot boxes, parental controls, age assurance | No |

Result: **4+**.

## Pricing and Availability

- Price: **$9.99**, one time (no in-app purchases, no subscription).
- Availability: all countries and regions.
- Distribution: public, iPhone and iPad, one purchase for both (not on Mac with Apple silicon: the Mac has its own free app).

## App Privacy

- Privacy policy URL: `https://viewswitcher.com/privacy` (SITE-17)
- Data collection: **"No, we do not collect data from this app."**
  The app talks only to the ViewSwitcher server on the user's own Mac, over the USB-C cable or their own
  Wi-Fi once paired. Nothing is sent to the developer or anyone else: no accounts, analytics, crash reporting, ads
  or tracking. `PrivacyInfo.xcprivacy` says the same (no tracking, no collected data types). The camera is
  used only to read the Mac's pairing QR code, on the device; no image leaves it.
- Privacy label shown on the store: **Data Not Collected**.

## Screenshots

Made by `bash apps/apple/scripts/ipad-shots.sh` (iPad) and `IPHONE=1 bash apps/apple/scripts/ipad-shots.sh`
(iPhone) into `AppStore/screenshots/`, `screenshots/iphone/` and `screenshots/iphone-6.3/` (gitignored):
the real app in the simulator, connected to a scratch switcher with a stand-in OBS that's live, on two
shows only, the sports podcast (Full Count) and the church (Grace Community), with photos in their camera
boxes. `raw/<name>.png` is the capture; `<name>.png` the App Store version: a portrait canvas on
ViewSwitcher's dark ground, the logo, a two-line headline and a subtitle over the device (sideways for a
landscape capture). Upload the framed ones, in these orders.

### 13-inch iPad (2064 × 2752)

1. `1-stream-landscape.png`: "Look professional / when you go live." Full Count's Ep. 112, Both hosts on air, OBS live
2. `2-editor-landscape.png`: "Change titles / while you're live." The episode title retyped on the view that's on air
3. `3-templates-landscape.png`: "Your show's look, / ready to go." Grace Community's templates
4. `4-sermon-portrait.png`: "Tap a view. / OBS switches." Grace Community upright, the sermon on air
5. `5-pastor-landscape.png`: "Run the service / without a crew." Grace Community, Pastor on air

### iPhone: 6.9-inch (1320 × 2868, `iphone/`) and 6.3-inch "medium display" (1206 × 2622, `iphone-6.3/`)

The same four, from the iPhone 17 Pro Max simulator. Sideways first: most people hold the phone like a deck.

1. `1-deck-landscape.png`: "Tap a view. / OBS switches." Full Count's deck, Both hosts on air
2. `2-sermon-portrait.png`: "Always know / what's on air." Grace Community upright, the sermon on top
3. `3-pair-portrait.png`: "Scan the code. / You're connected." The app's own connector: Scan the code, Enter code, or USB-C
4. `4-pastor-landscape.png`: "Your whole show, / in your pocket." Grace Community's deck, Pastor on air

## First version (1.2.1): text

### Promotional text (170)

```
Look professional when you go live. Tap a view on your iPhone or iPad and OBS switches: your camera, screen and titles move into place.
```

### Description (4000)

```
Look professional when you go live.

ViewSwitcher is a one-click scene switcher for OBS. Set up your views once: a "starting soon", a talking head, your camera beside a screen share, an interview, a "be right back" and a goodbye, all in your show's colors with this week's title. Then run the whole show from your iPhone or the iPad beside you. Tap a view and the stream changes. Your camera, guest and screen share move to where the view puts them, and OBS keeps streaming the way it always does.

Made for anyone running a recurring live show without a crew: a cooking show, a weekly class, a church service, a podcast.

ON YOUR IPHONE AND IPAD
• One tap switches the scene: every view is a big cover you can hit without looking twice
• On iPhone, turn it sideways and your views fill the screen like a deck
• The view on air marked in red, so you always know what people see
• Go live, record, and see that OBS is connected
• Plug into the Mac with a USB-C cable: no Wi-Fi, no setup
• Or pair over Wi-Fi in seconds: scan the code your Mac shows with the app's own camera, or type it in. Only devices you pair can switch scenes
• Portrait or landscape; on iPad, Split View and Stage Manager too
• One purchase for iPhone and iPad
• The screen stays awake while you run the show

TRY IT FIRST
Open the app with no Mac nearby and it starts a demo: a sample cooking show where you can tap views and watch the program change.

WHAT YOU NEED
ViewSwitcher for iPhone and iPad is the remote for ViewSwitcher on your Mac. You'll need:
• A Mac running ViewSwitcher (free from viewswitcher.com) and OBS, the free streaming app
• A camera OBS can see: a webcam, the Mac's own camera, or any other

ViewSwitcher for Mac is free and open source, and sets up OBS for you the first time. The iPhone and iPad app is a one-time purchase: no subscription, no account, no ads, and it collects no data.
```

### Keywords (100)

```
stream,live,streaming,scene,scenes,switcher,church,podcast,teacher,remote,control,broadcast,video
```

### Support URL

`https://viewswitcher.com/support` (SITE-17)

### Marketing URL

`https://viewswitcher.com`

### Version and copyright

- Version: `MARKETING_VERSION` in `apps/apple/project.yml` (1.2.1 for the first App Store release, the same as the Mac app). The build number is set by `bun run ipad:release` (UTC time, always increasing).
- Copyright: `2026 2wit Studios`

## App Review Information

- Sign-in required: **No** (there are no accounts).
- Contact: Jono's name, phone and email, entered in App Store Connect at submission (not kept in the repo).

### Notes (4000)

```
ViewSwitcher for iPhone and iPad is the remote for ViewSwitcher on the Mac, which drives OBS (the free streaming app). Full use needs a Mac running ViewSwitcher and OBS, connected by a USB-C cable or paired over the same Wi-Fi. The same app runs on iPhone and iPad; on iPhone, sideways shows the views as a deck.

WHAT THE APP DOES ON THE DEVICE
Like a presentation remote, the app is the touch surface for software on the user's Mac. On the device itself it: runs a USB-C tunnel to the Mac over the cable (Network framework), so no Wi-Fi is needed; scans the Mac's pairing QR code with VisionKit and pairs the device; finds the Mac on the Wi-Fi with Bonjour when the user types the code instead; keeps the screen awake while a show runs; and includes a complete offline demo show, so every control can be tried without a Mac.

TRY IT WITHOUT A MAC: THE DEMO
1. Open the app. With no Mac connected it opens the demo by itself: a sample cooking show, "Saltwater Kitchen", in the same switcher the app shows with a Mac. A grey "Demo" pill says it's a demo (on iPad at the top right, beside the "Connect your Mac" button; on iPhone in the bar along the bottom).
2. Tap any view under "Views". The program at the top ("On the stream") cuts to it, the camera and guest move into their new places, and the red "On air" ring moves to the view you tapped. (On iPhone held sideways, the program is on the left and the views beside it.)
3. "Connect your Mac" opens the connector, which looks for the Mac and shows how to connect. "Try the demo" there opens the demo again.
Nothing in the demo is streamed or sent anywhere; it is all inside the app and works offline.

WITH A MAC (OPTIONAL)
1. On a Mac, install ViewSwitcher (free: https://github.com/2witstudios/viewswitcher/releases) and OBS (https://obsproject.com). ViewSwitcher sets up OBS from its first window.
2. Plug the iPhone or iPad (a USB-C model) into the Mac with a USB-C cable and open the app. It connects by itself and shows the same views as the Mac. Tapping a view switches what OBS streams.
3. Without the cable, pair over Wi-Fi (the device and the Mac on the same Wi-Fi network):
   a. On the Mac, click ViewSwitcher in the menu bar and turn on "Let Phones and Tablets on This Wi-Fi Connect", then choose "Phones and Tablets…". The window shows a QR code and a one-time code (like K7PQ-2MXA, valid for 5 minutes).
   b. In the app, tap "Connect your Mac" if the demo is showing, then "Scan the code" and point the camera at the QR code. The app asks for the camera only for this, and for Local Network access to reach the Mac.
   c. Or tap "Enter code": the app finds the Mac on the Wi-Fi and shows "Pair with ViewSwitcher". Enter the code and tap Pair.
   The switcher opens, and the device appears under "Paired devices" on the Mac, where Remove disconnects it at once.

The app has no accounts, in-app purchases, ads or analytics, and collects no data.
```

### Attachment

None. (The demo shows the app working without a Mac.)

## Export compliance

`ITSAppUsesNonExemptEncryption` is `NO` in the app's Info.plist, so App Store Connect doesn't ask
per build. The app has no encryption of its own; any HTTPS it loads is the operating system's own. If asked: "None of the algorithms mentioned above" → no documents needed.
