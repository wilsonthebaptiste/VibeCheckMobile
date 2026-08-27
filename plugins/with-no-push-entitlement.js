/**
 * Removes the `aps-environment` entitlement that expo-notifications adds.
 *
 * `expo-notifications` ships an `app.plugin.js`, so Expo autolinking applies it
 * whether or not it is listed in app.json's `plugins`, and its iOS mod sets
 * `aps-environment: development` unconditionally. That is the entitlement for
 * REMOTE push -- and it is exactly the one a free Apple ID cannot sign. Leaving
 * it in makes Sideloadly fail at install with a provisioning-profile error that
 * says nothing about notifications.
 *
 * VibeCheck only ever sends LOCAL notifications (see src/utils/notifications.ts):
 * everything is scheduled on the device, there is no push server, and no token
 * is ever requested. So the entitlement buys nothing and costs the whole
 * free-signing path.
 *
 * Delete this plugin if real push is ever added -- at which point the $99/yr
 * Apple Developer Program is required anyway, and the entitlement becomes
 * signable.
 */

const { withEntitlementsPlist } = require('expo/config-plugins');

const withNoPushEntitlement = (config) =>
  withEntitlementsPlist(config, (config) => {
    delete config.modResults['aps-environment'];
    return config;
  });

module.exports = withNoPushEntitlement;
