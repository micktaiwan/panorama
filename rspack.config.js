const { defineConfig } = require('@meteorjs/rspack');

/**
 * Rspack configuration for Meteor projects.
 *
 * Provides typed flags on the `Meteor` object, such as:
 * - `Meteor.isClient` / `Meteor.isServer`
 * - `Meteor.isDevelopment` / `Meteor.isProduction`
 * - …and other flags available
 *
 * Use these flags to adjust your build settings based on environment.
 */
module.exports = defineConfig(Meteor => {
  return {
    // The bundler's dev server otherwise binds to every interface, so the office
    // or café Wi-Fi can reach it alongside the app itself. Nothing outside this
    // machine ever needs it: the browser that loads the hot-reload socket is the
    // one on this laptop. `meteor run --port 127.0.0.1:<port>` does the same for
    // the app and its proxy, and this covers the third listener they open.
    devServer: { host: '127.0.0.1' },
  };
});
