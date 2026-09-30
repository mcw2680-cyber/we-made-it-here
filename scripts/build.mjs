import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
for (const file of ['index.html', 'styles.css', 'app.js', 'config.js', 'membership.js', 'membership-config.js', 'founding-50.html', 'application-received.html', 'founding-50-approved.png', 'manifest.webmanifest']) {
  await copyFile(file, `dist/${file}`);
}
