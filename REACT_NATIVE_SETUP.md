# React Native Setup Guide for FaceAttend Android

This guide provides step-by-step instructions for setting up the React Native environment to convert the FaceAttend project into an Android application.

## 1. Prerequisites
Before you begin, ensure you have the following installed on your machine:
- **Node.js** (version 14.x or later)
- **Watchman** (for macOS users)
- **Java Development Kit (JDK)** (version 8 or later)
- **Android Studio**
- **React Native CLI** 

## 2. Setting Up the Environment

### Install Node.js
- Download and install Node.js from [Node.js official site](https://nodejs.org/).
- Verify installation:
  ```bash
  node -v
  npm -v
  ```

### Install Watchman (for macOS users)
- Use Homebrew to install Watchman:
  ```bash
  brew install watchman
  ```

### Install JDK
- Download and install the JDK from [Oracle's official site](https://www.oracle.com/java/technologies/javase-jdk8-downloads.html).
- Set the JAVA_HOME environment variable:
  ```bash
  export JAVA_HOME=$(/usr/libexec/java_home)
  ```

### Install Android Studio
- Download and install [Android Studio](https://developer.android.com/studio).
- During installation, ensure you include the Android SDK.
- Set up an Android emulator (Pixel 4 API 30 recommended).

## 3. Create React Native Project
- Navigate to the desired directory:
  ```bash
  cd your/desired/directory
  ```
- Create a new React Native project:
  ```bash
  npx react-native init FaceAttend
  ```

## 4. Clone the FaceAttend Repository
- Clone the repository to your local machine:
  ```bash
  git clone https://github.com/JoeI-5822/attendance-management-face-recognition.git
  cd attendance-management-face-recognition
  ```

## 5. Install Dependencies
- Navigate to the FaceAttend project directory:
  ```bash
  cd FaceAttend
  ```
- Install all necessary dependencies:
  ```bash
  npm install
  ```

## 6. Configure Android Environment
- Open `android/local.properties` and set the SDK path:
  ```properties
  sdk.dir=/path/to/android/sdk
  ```
- Make sure to enable the appropriate permissions in the `AndroidManifest.xml` for camera and Internet access.

## 7. Run the Application
- Start the Metro bundler:
  ```bash
  npx react-native start
  ```
- Open a new terminal tab and run the application on Android:
  ```bash
  npx react-native run-android
  ```

## 8. Troubleshooting
- **Metro bundler not starting:** Make sure your Node.js installation is correct and try clearing cache:
  ```bash
  npx react-native start --reset-cache
  ```
- **Build issues:** Ensure that all dependencies are installed correctly. Check if the JDK and Android SDK paths are configured properly.
- **Device not found:** Ensure that your Android emulator is running and visible in the ADB devices list:
  ```bash
  adb devices
  ```

## Conclusion
Follow these steps carefully to set up your React Native environment for FaceAttend. If you encounter any issues, refer to the official [React Native documentation](https://reactnative.dev/docs/getting-started) for additional guidance.
