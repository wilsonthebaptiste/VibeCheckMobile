# Expo project notes for AI agents

This project targets **Expo SDK 56** (downgraded from SDK 57 due to an unresolved
Expo Go native crash bug — see PROGRESS.md for details). Expo's APIs change
rapidly between SDK versions — before writing any code touching Expo Router,
NativeTabs, expo-location, or other Expo-managed packages, check SDK-56-specific
docs, not general training knowledge or newer/older SDK docs:

https://docs.expo.dev/versions/v56.0.0/

Do not upgrade the Expo SDK version without first checking
https://github.com/expo/expo/issues for open crash/regression reports against
the target version — this project has already been burned by an unstable SDK
release once.