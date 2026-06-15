/**
 * Airone AI Backbone - Render API Client
 * Deploys LNN models to the existing airone-brain-template service.
 * Supports multi-model: all robots share one brain service, routed by ?robot=name.
 *
 * How it works:
 * 1. Get existing models from the brain-template's MODEL_CONFIG env var
 * 2. Add/update the new robot's model in the config
 * 3. Update the env var and trigger a redeploy
 * 4. Poll until the service is live
 * 5. Return the brain URL with ?robot=robot-name
 */

const axios = require('axios');

const RENDER_API_BASE = 'https://api.render.com/v1';
const RENDER_API_KEY = 'rnd_4g4q8NK7SoDjx6MT4Q53aFYJwBON';

// The single brain-template service that hosts all robot models
const BRAIN_SERVICE_ID = 'srv-d8dh9esm0tmc73duts10';
const BRAIN_SERVICE_NAME = 'airone-brain-template';

const POLL_INTERVAL_MS = 10000;  // 10 seconds
const POLL_TIMEOUT_MS = 300000;  // 5 minutes (free plan deploys are slow)

const headers = {
  'Authorization': `Bearer ${RENDER_API_KEY}`,
  'Content-Type': 'application/json',
  'Accept': 'application/json'
};

/**
 * Get the current MODEL_CONFIG from the brain-template service.
 */
async function getCurrentModelConfig() {
  try {
    const response = await axios.get(
      `${RENDER_API_BASE}/services/${BRAIN_SERVICE_ID}/env-vars`,
      { headers, timeout: 15000 }
    );

    const envVars = response.data || [];
    for (const ev of envVars) {
      const envVar = ev.envVar || ev;
      if (envVar.key === 'MODEL_CONFIG') {
        try {
          return JSON.parse(envVar.value || '{}');
        } catch (_e) {
          return {};
        }
      }
    }
    return {};
  } catch (err) {
    console.warn('[RenderClient] Could not get current MODEL_CONFIG:', err.message);
    return {};
  }
}

/**
 * Infer output_types from pin descriptions if not already set in the model config.
 * @param {Object} modelConfig - LNN model configuration
 * @param {Object} outputMapping - Mapping of output pin names to indices
 * @returns {Object} The modelConfig with output_types populated
 */
function ensureOutputTypes(modelConfig, outputMapping) {
  if (modelConfig.output_types && Object.keys(modelConfig.output_types).length > 0) {
    return modelConfig; // Already has output_types
  }

  const outputTypes = {};
  for (const name of Object.keys(outputMapping || {})) {
    const desc = (name || '').toLowerCase();
    if (desc.includes('motor') || desc.includes('speed') || desc.includes('pwm')) {
      outputTypes[name] = 'pwm';
    } else if (desc.includes('servo') || desc.includes('angle') || desc.includes('arm') || desc.includes('hand') || desc.includes('leg')) {
      outputTypes[name] = 'servo';
    } else {
      outputTypes[name] = 'digital';
    }
  }
  modelConfig.output_types = outputTypes;
  console.log(`[RenderClient] Inferred output_types: ${JSON.stringify(outputTypes)}`);
  return modelConfig;
}

/**
 * Deploy a brain model to the existing brain-template service (multi-model).
 *
 * @param {Object} params
 * @param {string} params.robotId - The robot's database ID
 * @param {string} params.robotName - The robot's name (used for routing)
 * @param {Object} params.modelConfig - LNN model configuration with trained weights
 * @returns {Promise<Object>} { brain_url, api_key, service_id }
 */
async function deployBrainService({ robotId, robotName, modelConfig }) {
  // Build robot key from name (lowercase, no spaces)
  const robotKey = (robotName || 'default').toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

  console.log(`[RenderClient] Deploying model for robot: ${robotKey}`);

  // If modelConfig itself is in single-model format (has input_size at top level),
  // ensure it has output_types before wrapping into multi-model format
  if (modelConfig && modelConfig.input_size !== undefined) {
    ensureOutputTypes(modelConfig, modelConfig.output_mapping || {});
  }

  // Get current multi-model config
  let multiModelConfig = {};
  try {
    multiModelConfig = await getCurrentModelConfig();
  } catch (_e) {
    console.warn('[RenderClient] Starting with fresh model config');
  }

  // Handle case where existing config is single-model format
  if (multiModelConfig.input_size !== undefined) {
    // Convert single-model to multi-model format
    const existingName = multiModelConfig._robot_name || 'default';
    const singleConfig = { ...multiModelConfig };
    delete singleConfig._robot_name;
    // Ensure output_types on existing config too
    ensureOutputTypes(singleConfig, singleConfig.output_mapping || {});
    multiModelConfig = { [existingName]: singleConfig };
  }

  // Add/update this robot's model
  multiModelConfig[robotKey] = modelConfig;

  console.log(`[RenderClient] Multi-model config now has ${Object.keys(multiModelConfig).length} robot(s): ${Object.keys(multiModelConfig).join(', ')}`);

  // Build env vars for the service
  const envVars = [
    { key: 'MODEL_CONFIG', value: JSON.stringify(multiModelConfig) },
    { key: 'PORT', value: '10000' }
  ];

  try {
    // Update env vars on the existing service
    console.log(`[RenderClient] Updating MODEL_CONFIG on ${BRAIN_SERVICE_NAME}...`);

    // First, try to set env vars via the API
    try {
      await axios.put(
        `${RENDER_API_BASE}/services/${BRAIN_SERVICE_ID}/env-vars`,
        envVars.map(ev => ({ key: ev.key, value: ev.value })),
        { headers, timeout: 15000 }
      );
      console.log('[RenderClient] Updated env vars successfully');
    } catch (envErr) {
      // If PUT doesn't work, try the per-var approach
      console.warn('[RenderClient] Bulk env update failed, trying per-var:', envErr.message);
      for (const ev of envVars) {
        try {
          await axios.put(
            `${RENDER_API_BASE}/services/${BRAIN_SERVICE_ID}/env-vars/${ev.key}`,
            { value: ev.value },
            { headers, timeout: 15000 }
          );
        } catch (perVarErr) {
          console.warn(`[RenderClient] Failed to set ${ev.key}:`, perVarErr.message);
        }
      }
    }

    // Trigger a manual deploy with the new env vars
    console.log('[RenderClient] Triggering redeploy...');
    try {
      await axios.post(
        `${RENDER_API_BASE}/services/${BRAIN_SERVICE_ID}/deploys`,
        {},
        { headers, timeout: 15000 }
      );
      console.log('[RenderClient] Deploy triggered successfully');
    } catch (deployErr) {
      console.warn('[RenderClient] Could not trigger deploy via API:', deployErr.message);
      // The env var change might auto-trigger a deploy on some plans
    }

    // Poll until the service is live
    console.log('[RenderClient] Waiting for service to go live...');
    const service = await pollUntilLive(BRAIN_SERVICE_ID);

    // Build the brain URL with robot name routing
    const serviceDetails = service.serviceDetails || {};
    const hostname = serviceDetails.url
      ? serviceDetails.url.replace('https://', '').replace('http://', '')
      : `${BRAIN_SERVICE_NAME}.onrender.com`;

    // The brain URL includes the robot name for routing
    const brainUrl = `https://${hostname}/?robot=${robotKey}`;
    const wsUrl = `wss://${hostname}/?robot=${robotKey}`;

    console.log(`[RenderClient] Service deployed! Brain URL: ${brainUrl}`);
    console.log(`[RenderClient] WebSocket URL: ${wsUrl}`);

    return {
      brain_url: brainUrl,
      ws_url: wsUrl,
      api_key: `airo-${robotKey}`,  // Robot name acts as the key
      service_id: BRAIN_SERVICE_ID,
      robot_key: robotKey,
      multi_model: true,
      total_robots: Object.keys(multiModelConfig).length
    };
  } catch (err) {
    if (err.response) {
      const status = err.response.status;
      const data = err.response.data;
      throw new Error(`Render API error (${status}): ${JSON.stringify(data)}`);
    }
    throw new Error(`Brain service deployment failed: ${err.message}`);
  }
}

/**
 * Poll the Render API until the service has deployStatus 'live'.
 */
async function pollUntilLive(serviceId) {
  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const poll = async () => {
      try {
        const response = await axios.get(
          `${RENDER_API_BASE}/services/${serviceId}`,
          { headers, timeout: 15000 }
        );

        const service = response.data;
        const status = service.deployStatus || service.status;

        console.log(`[RenderClient] Service ${serviceId} status: ${status}`);

        if (status === 'live') {
          resolve(service);
          return;
        }

        if (status === 'build_failed' || status === 'deploy_failed' || status === 'canceled') {
          reject(new Error(`Service deployment failed with status: ${status}`));
          return;
        }

        // Check timeout
        if (Date.now() - startTime > POLL_TIMEOUT_MS) {
          // Even if timeout, return the service if it was previously live
          console.warn('[RenderClient] Poll timeout, but service may still be deploying');
          resolve(service);
          return;
        }

        // Continue polling
        setTimeout(poll, POLL_INTERVAL_MS);
      } catch (err) {
        if (Date.now() - startTime > POLL_TIMEOUT_MS) {
          reject(new Error(`Service deployment timed out after network errors`));
          return;
        }

        console.warn('[RenderClient] Poll error, retrying:', err.message);
        setTimeout(poll, POLL_INTERVAL_MS);
      }
    };

    poll();
  });
}

/**
 * Get the status of the brain service.
 */
async function getServiceStatus(serviceId) {
  try {
    const response = await axios.get(
      `${RENDER_API_BASE}/services/${serviceId || BRAIN_SERVICE_ID}`,
      { headers, timeout: 15000 }
    );
    return response.data;
  } catch (err) {
    if (err.response) {
      const status = err.response.status;
      const data = err.response.data;
      throw new Error(`Render API error (${status}): ${JSON.stringify(data)}`);
    }
    throw new Error(`Failed to get service status: ${err.message}`);
  }
}

/**
 * Get the health of the brain service directly.
 */
async function getBrainHealth() {
  try {
    const response = await axios.get(
      `https://${BRAIN_SERVICE_NAME}.onrender.com/health`,
      { timeout: 15000 }
    );
    return response.data;
  } catch (err) {
    throw new Error(`Brain health check failed: ${err.message}`);
  }
}

module.exports = {
  deployBrainService,
  getServiceStatus,
  getBrainHealth,
  BRAIN_SERVICE_ID,
  BRAIN_SERVICE_NAME
};
