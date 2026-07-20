#!/bin/bash
export ANDROID_HOME=/workspace/android-sdk
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
export PATH=$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH

cd /workspace/apk-generator/backend
node server.js
