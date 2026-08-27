import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { VisitIntentProvider } from '@/hooks/use-visit-intent';
// Imported for its side effect: defining the geofence TaskManager task. When
// iOS relaunches a terminated app for a boundary crossing it expects the task
// to exist by the time the bundle finishes evaluating, so this must happen at
// module scope, not inside a component or an effect -- otherwise the event is
// dropped silently, in exactly the situation the feature exists for.
import '@/utils/geofence';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      {/* Mounted at the root, not on the map screen. The two moments this
          exists for -- arriving somewhere, and having been there half an hour
          -- happen while the user is doing something else, and a provider on
          one screen would stop watching the moment they navigated away. */}
      <VisitIntentProvider>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="venue/[id]" options={{ headerShown: true, title: 'Venue' }} />
        </Stack>
      </VisitIntentProvider>
    </ThemeProvider>
  );
}