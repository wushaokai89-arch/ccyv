const express = require('express');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const TEMPLATE_DIR = path.join(__dirname, '..', '..', 'webview-app');
const OUTPUT_DIR = path.join(__dirname, 'output');
const ANDROID_HOME = process.env.ANDROID_HOME || '/workspace/android-sdk';
const JAVA_HOME = process.env.JAVA_HOME || '/usr/lib/jvm/java-17-openjdk-amd64';

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

app.use('/output', (req, res, next) => {
  if (req.path.endsWith('.apk')) {
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Content-Disposition', 'attachment; filename="app-release.apk"');
  }
  next();
});
app.use('/output', express.static(OUTPUT_DIR));
app.use(express.static(path.join(__dirname, '..', 'frontend')));

app.post('/api/generate', async (req, res) => {
  try {
    const { url, appName, iconUrl } = req.body;
    if (!url || !appName) {
      return res.json({ success: false, message: '网址和应用名称为必填' });
    }

    const taskId = uuidv4();
    const taskDir = path.join('/tmp', 'apk-build', taskId);
    copyDir(TEMPLATE_DIR, taskDir);

    const mainActivityPath = path.join(taskDir, 'app', 'src', 'main', 'java', 'com', 'webview', 'app', 'MainActivity.java');
    let content = fs.readFileSync(mainActivityPath, 'utf-8');
    content = content.replace(/private static final String TARGET_URL = ".*?";/, `private static final String TARGET_URL = "${escapeJava(url)}";`);
    fs.writeFileSync(mainActivityPath, content);

    const stringsPath = path.join(taskDir, 'app', 'src', 'main', 'res', 'values', 'strings.xml');
    let stringsContent = fs.readFileSync(stringsPath, 'utf-8');
    stringsContent = stringsContent.replace(/<string name="app_name">.*?<\/string>/, `<string name="app_name">${escapeXml(appName)}</string>`);
    fs.writeFileSync(stringsPath, stringsContent);

    const buildFile = path.join(taskDir, 'app', 'build.gradle');
    let buildContent = fs.readFileSync(buildFile, 'utf-8');
    buildContent = buildContent.replace(/applicationId ".*?"/, `applicationId "com.webview.a${taskId.replace(/-/g, '')}"`);
    fs.writeFileSync(buildFile, buildContent);

    if (iconUrl) {
      try {
        await downloadIcon(iconUrl, taskDir);
      } catch (e) {
        console.log('图标下载失败，使用默认图标:', e.message);
      }
    }

    console.log(`开始构建 APK: taskId=${taskId}, url=${url}, appName=${appName}`);
    execSync(`cd ${taskDir} && chmod +x gradlew && ANDROID_HOME=${ANDROID_HOME} JAVA_HOME=${JAVA_HOME} ./gradlew assembleDebug`, {
      env: { ...process.env, ANDROID_HOME, JAVA_HOME },
      stdio: 'pipe',
      timeout: 300000
    });

    const apkOutputDir = path.join(taskDir, 'app', 'build', 'outputs', 'apk', 'debug');
    const apkFiles = fs.readdirSync(apkOutputDir).filter(f => f.endsWith('.apk'));

    if (apkFiles.length === 0) {
      return res.json({ success: false, message: 'APK 构建失败，未找到输出文件' });
    }

    const outputApk = path.join(OUTPUT_DIR, `${taskId}.apk`);
    fs.copyFileSync(path.join(apkOutputDir, apkFiles[0]), outputApk);
    fs.rmSync(taskDir, { recursive: true, force: true });

    console.log(`APK 生成成功: ${outputApk}`);
    res.json({
      success: true,
      downloadUrl: `/output/${taskId}.apk`,
      message: 'APK 生成成功'
    });
  } catch (err) {
    console.error('构建错误:', err.message);
    res.json({ success: false, message: `编译失败: ${err.message}` });
  }
});

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function escapeJava(str) {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function escapeXml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function downloadIcon(iconUrl, taskDir) {
  const http = iconUrl.startsWith('https') ? require('https') : require('http');
  return new Promise((resolve, reject) => {
    http.get(iconUrl, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`下载图标失败: ${response.statusCode}`));
        return;
      }
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const mipmapDir = path.join(taskDir, 'app', 'src', 'main', 'res', 'mipmap-hdpi');
        if (!fs.existsSync(mipmapDir)) fs.mkdirSync(mipmapDir, { recursive: true });
        fs.writeFileSync(path.join(mipmapDir, 'ic_launcher.png'), buffer);
        resolve();
      });
    }).on('error', reject);
  });
}

app.listen(PORT, () => {
  console.log(`APK Generator 后端运行在 http://localhost:${PORT}`);
});
