# GMD mobile-child — Play Console permission declarations

## ACCESS_BACKGROUND_LOCATION

**Core functionality:** continuously report child's location to parents even when the app is closed, for safety purposes.
**User flow:** During onboarding, child explicitly grants background location after parent creates the invite and child device is claimed. Persistent foreground notification shows location is being reported.

## BIND_DEVICE_ADMIN (Device Administrator API)

**Core functionality:** Parental control for minors — prevent accidental or unauthorized uninstall of the safety monitoring app.
**User type:** Minors with parental consent.
**User flow:** Onboarding explicitly asks child to activate Device Administrator. The explanation text states parents will be notified on deactivation attempts. Child can still disable via Settings → Security → Device admin.

## FOREGROUND_SERVICE_LOCATION

**Core functionality:** Background location for parental monitoring (same justification as ACCESS_BACKGROUND_LOCATION).

## Supporting docs

- Privacy Policy: https://gmd.link28rus.ru/privacy
- Parent consent evidence: stored in ConsentRecord table at claim time
- Demo video: [upload 2-min onboarding flow showing explicit consent UI]
