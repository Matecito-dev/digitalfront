/** Capacitor — empaqueta el viewer Phaser (npm run app:build), no el lab Pixi. */
const config = {
  appId: "com.digitalfront.game",
  appName: "Digital Front",
  webDir: "../app-www",
  server: {
    androidScheme: "https",
  },
  android: {
    allowMixedContent: true,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
      launchAutoHide: false,
      backgroundColor: "#050810",
    },
    ScreenOrientation: {
      orientation: "landscape",
    },
  },
};

export default config;
