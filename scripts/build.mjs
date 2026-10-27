import fs from 'node:fs/promises';
import path from 'node:path';
import { projectRoot, pathsAndConfig, assertNoSymlinkTree, copyChecked, fileManifest, isWithin } from './common.mjs';
import { validateSite } from './validate.mjs';
try {
  const startedAt = new Date().toISOString();
  const { config, source, original, output } = await pathsAndConfig();
  await assertNoSymlinkTree(source);
  await assertNoSymlinkTree(original);
  const sourceBefore = await fileManifest(source);
  const originalManifest = await fileManifest(original);
  const originalByPath = new Map(originalManifest.map(item => [item.path, item]));
  const expectedOutput = path.resolve(projectRoot, 'dist');
  const realProjectRoot = await fs.realpath(projectRoot);
  const realOutputParent = await fs.realpath(path.dirname(output));
  if (path.resolve(output) !== expectedOutput || !isWithin(projectRoot, output) || realOutputParent !== realProjectRoot || output === source || output === original) {
    throw new Error('Refusing to clean an output directory that is not exactly this project/dist.');
  }
  // Reject symbolic links and junctions before any recursive removal.
  await assertNoSymlinkTree(output);
  console.log(`Verified clean target: ${expectedOutput}`);
  await fs.rm(expectedOutput, { recursive: true, force: true });
  await fs.mkdir(expectedOutput, { recursive: true });
  for (const item of config.include) await copyChecked(path.join(source, item), path.join(expectedOutput, item));
  const sourceAfter = await fileManifest(source);
  if (JSON.stringify(sourceBefore) !== JSON.stringify(sourceAfter)) throw new Error('Source files changed during the build; rerun after edits finish.');
  const validation = await validateSite(output, { originalDirectory: original, requireNoExternalRuntimeResources: config.requireNoExternalRuntimeResources });
  const expectedFiles = sourceAfter.filter(item => config.include.some(include => item.path === include || item.path.startsWith(include + '/')));
  if (JSON.stringify(expectedFiles) !== JSON.stringify(validation.files)) throw new Error('Build output bytes differ from the selected source files.');
  const sourceDifferences = sourceAfter.filter(item => originalByPath.get(item.path)?.sha256 !== item.sha256).map(item => ({ path: item.path, originalSha256: originalByPath.get(item.path)?.sha256 ?? null, sourceSha256: item.sha256 }));
  const sourcePaths = new Set(sourceAfter.map(item => item.path));
  const report = {
    schemaVersion: 1, status: 'succeeded', startedAt, completedAt: new Date().toISOString(),
    nodeVersion: process.version, packageManagerUserAgent: process.env.npm_config_user_agent ?? null,
    applicationFramework: 'Static HTML/CSS/vanilla JavaScript; no app framework runtime',
    dependencyPolicy: 'No runtime or development npm dependencies; migration scripts use Node built-ins only',
    toolingOrigin: 'New migration-only tooling; the original site had no package manifest, lockfile, or build configuration',
    sourceDirectory: 'site', originalSnapshotDirectory: 'original', outputDirectory: 'dist',
    proposedProductionOrigin: config.proposedProductionOrigin, productionOriginAppliedToHtml: false,
    bytesCopiedWithoutTransformation: true, sourceDifferencesFromOriginal: sourceDifferences,
    removedSourcePathsFromOriginal: originalManifest.filter(item => !sourcePaths.has(item.path)).map(item => item.path),
    originalSnapshotFileCount: originalManifest.length, selectedSourceFileCount: expectedFiles.length, validation
  };
  const reportPath = path.join(projectRoot, 'provenance', 'build-report.json');
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(`Build succeeded: ${validation.fileCount} files in dist/, with index.html at the root.`);
  console.log(`Validation passed: ${validation.checkedResourceReferenceCount} resource references; no missing local resources, duplicate IDs, or broken anchors.`);
  console.log('The intentional GitHub issue-template link is unchanged. No original/ or site/ files were rewritten.');
  console.log('Build report: provenance/build-report.json');
} catch (error) { console.error(`Build failed: ${error.message}`); process.exitCode = 1; }
