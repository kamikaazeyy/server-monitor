const { execFile } = require('child_process');
const path = require('path');
const express = require('express');

const router = express.Router();
const FITSO_MOBILE_DIR = process.env.FITSO_MOBILE_DIR || '/home/kamikaazeyy/fitso/mobile';
const EAS_TOKEN = process.env.EXPO_TOKEN;

if (!EAS_TOKEN) {
  console.warn('[builds] EXPO_TOKEN not set — EAS build endpoints will return errors');
}

/**
 * Run a command with EAS_TOKEN in the environment and return parsed JSON.
 * All EAS commands run with --json --non-interactive which implies non-interactive.
 */
function runEas(args, options = {}) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      EXPO_TOKEN: EAS_TOKEN,
    };
    execFile('eas', args, {
      cwd: FITSO_MOBILE_DIR,
      env,
      maxBuffer: 10 * 1024 * 1024,
      ...options,
    }, (err, stdout, stderr) => {
      if (err) {
        const message = stderr?.trim() || err.message;
        reject(new Error(message));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

/**
 * GET /api/builds
 * List recent EAS builds for Android.
 */
router.get('/api/builds', async (req, res) => {
  if (!EAS_TOKEN) return res.status(500).json({ error: 'EXPO_TOKEN not configured' });
  try {
    const raw = await runEas([
      'build:list',
      '--platform', 'android',
      '--limit', '20',
      '--json',
      '--non-interactive',
    ]);
    const builds = JSON.parse(raw || '[]');
    const mapped = builds.map(b => ({
      id: b.id,
      profile: b.buildProfile,
      platform: b.platform,
      status: b.status,
      distribution: b.distribution,
      buildType: b.buildType,
      sdkVersion: b.sdkVersion,
      appVersion: b.appVersion,
      gitCommitHash: b.gitCommitHash,
      gitCommitMessage: b.gitCommitMessage,
      channel: b.channel,
      message: b.message,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
      artifacts: b.artifacts,
      submissionStatus: b.submissionStatus,
    }));
    res.json(mapped);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/builds/:id
 * View a single build by ID.
 */
router.get('/api/builds/:id', async (req, res) => {
  if (!EAS_TOKEN) return res.status(500).json({ error: 'EXPO_TOKEN not configured' });
  const { id } = req.params;
  if (!id || !/^[a-zA-Z0-9-]+$/.test(id)) {
    return res.status(400).json({ error: 'Invalid build ID' });
  }
  try {
    const raw = await runEas(['build:view', id, '--json']);
    const b = JSON.parse(raw);
    res.json({
      id: b.id,
      profile: b.buildProfile,
      platform: b.platform,
      status: b.status,
      distribution: b.distribution,
      buildType: b.buildType,
      sdkVersion: b.sdkVersion,
      appVersion: b.appVersion,
      gitCommitHash: b.gitCommitHash,
      gitCommitMessage: b.gitCommitMessage,
      channel: b.channel,
      message: b.message,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
      artifacts: b.artifacts,
      submissionStatus: b.submissionStatus,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/builds
 * Trigger a new EAS build.
 * Body: { profile: 'preview' | 'development', message?: string }
 * Uses --no-wait so the request returns immediately with the build ID.
 */
router.post('/api/builds', async (req, res) => {
  if (!EAS_TOKEN) return res.status(500).json({ error: 'EXPO_TOKEN not configured' });
  const { profile, message } = req.body || {};
  const validProfiles = ['preview', 'development'];
  if (!validProfiles.includes(profile)) {
    return res.status(400).json({ error: `Invalid profile. Must be one of: ${validProfiles.join(', ')}` });
  }
  try {
    const args = [
      'build',
      '--platform', 'android',
      '--profile', profile,
      '--no-wait',
      '--json',
      '--non-interactive',
    ];
    if (message) {
      args.push('--message', String(message).slice(0, 240));
    }
    const raw = await runEas(args, { timeout: 120000 });
    // EAS build --json --no-wait returns an array of build objects
    const builds = JSON.parse(raw || '[]');
    const build = Array.isArray(builds) ? builds[0] : builds;
    if (!build) {
      return res.status(500).json({ error: 'No build was created' });
    }
    res.json({
      id: build.id,
      profile: build.buildProfile,
      status: build.status,
      message: 'Build started. Check /api/builds for status.',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/builds/:id/cancel
 * Cancel a running build.
 */
router.post('/api/builds/:id/cancel', async (req, res) => {
  if (!EAS_TOKEN) return res.status(500).json({ error: 'EXPO_TOKEN not configured' });
  const { id } = req.params;
  if (!id || !/^[a-zA-Z0-9-]+$/.test(id)) {
    return res.status(400).json({ error: 'Invalid build ID' });
  }
  try {
    await runEas(['build:cancel', id, '--non-interactive']);
    res.json({ ok: true, id, message: 'Build cancelled' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
