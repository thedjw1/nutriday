const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const express = require('express');
const mysql = require('mysql2/promise');

const {
  appendPlanToCloudState,
  buildPlanPayload,
  buildPlanResponseFromRecord,
  findLocalCloudState,
  isPlainObject,
  mergeCloudState,
  normalizeCloudState,
  parseJsonField,
  upsertLocalCloudState,
} = require('./cloud_state');

const app = express();
const PORT = Number(process.env.PORT || 8080);
const DATA_DIR = path.join(__dirname, 'data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');
const CLOUD_KNOWLEDGE_VERSION = 'backend-cloud-2026-03-07';

app.use(express.json({ limit: '10mb' }));

function createId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function ensureLocalStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(
      STORE_PATH,
      JSON.stringify(
        {
          users: [],
          sessions: [],
          healthDataLog: [],
          healthSnapshots: [],
          plans: [],
          reports: [],
          supplements: [],
          syncEvents: [],
          members: [],
          supplementBoxBindings: [],
          deviceBindings: [],
          memberStates: [],
          currentMemberIds: {},
        },
        null,
        2,
      ),
    );
  }
}

function readLocalStore() {
  ensureLocalStore();
  const rawStore = fs.readFileSync(STORE_PATH, 'utf8').replace(/^\uFEFF/, '');
  const store = JSON.parse(rawStore);
  return {
    users: Array.isArray(store.users) ? store.users : [],
    sessions: Array.isArray(store.sessions) ? store.sessions : [],
    healthDataLog: Array.isArray(store.healthDataLog) ? store.healthDataLog : [],
    healthSnapshots: Array.isArray(store.healthSnapshots) ? store.healthSnapshots : [],
    plans: Array.isArray(store.plans) ? store.plans : [],
    reports: Array.isArray(store.reports) ? store.reports : [],
    supplements: Array.isArray(store.supplements) ? store.supplements : [],
    syncEvents: Array.isArray(store.syncEvents) ? store.syncEvents : [],
    members: Array.isArray(store.members) ? store.members : [],
    supplementBoxBindings: Array.isArray(store.supplementBoxBindings)
      ? store.supplementBoxBindings
      : [],
    deviceBindings: Array.isArray(store.deviceBindings) ? store.deviceBindings : [],
    memberStates: Array.isArray(store.memberStates) ? store.memberStates : [],
    currentMemberIds:
      store.currentMemberIds && typeof store.currentMemberIds === 'object'
        ? store.currentMemberIds
        : {},
  };
}

function writeLocalStore(store) {
  ensureLocalStore();
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

function normalizeString(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function normalizeNullableString(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function normalizeNumber(value) {
  if (value == null || value === '') {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeBoolean(value) {
  return value === true || value === 1 || value === '1';
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => String(item ?? '').trim())
    .filter((item) => item.length > 0);
}

function normalizeDateTime(value, fallback = null) {
  if (value == null || value === '') {
    return fallback;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return fallback;
  }
  return date.toISOString();
}

function toMySqlDateTime(value, fallback = new Date()) {
  const iso = normalizeDateTime(
    value,
    normalizeDateTime(fallback, new Date().toISOString()),
  );
  return iso.replace('T', ' ').slice(0, 19);
}

function normalizeObject(value) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return { ...value };
}

function normalizeNutrientList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => ({
    name: normalizeString(item?.name),
    amount: normalizeNumber(item?.amount) ?? 0,
    unit: normalizeString(item?.unit),
  }));
}

function normalizeMemberRecord(rawValue, options = {}) {
  const now = new Date().toISOString();
  const createdAt = normalizeDateTime(
    rawValue?.createdAt,
    options.createdAtFallback || now,
  );
  return {
    id: normalizeString(rawValue?.id, options.idFallback || createId('member')),
    name: normalizeString(rawValue?.name || rawValue?.nickname, 'Member'),
    avatar: normalizeNullableString(rawValue?.avatar),
    relation: normalizeString(rawValue?.relation, 'self'),
    birthDate: normalizeDateTime(rawValue?.birthDate, null),
    gender: normalizeNullableString(rawValue?.gender),
    height: normalizeNumber(rawValue?.height),
    weight: normalizeNumber(rawValue?.weight),
    bloodType: normalizeNullableString(rawValue?.bloodType),
    allergies: normalizeStringList(rawValue?.allergies),
    chronicDiseases: normalizeStringList(rawValue?.chronicDiseases),
    medications: normalizeStringList(rawValue?.medications),
    isManaged: normalizeBoolean(rawValue?.isManaged),
    managerId: normalizeNullableString(rawValue?.managerId),
    extra: rawValue?.extra == null ? null : String(rawValue.extra),
    createdAt,
    updatedAt: normalizeDateTime(rawValue?.updatedAt, now),
  };
}

function normalizeSupplementBindingRecord(rawValue, memberId, options = {}) {
  return {
    id: normalizeString(
      rawValue?.id,
      options.idFallback || createId('supplement_box'),
    ),
    memberId,
    boxSlot: normalizeString(rawValue?.boxSlot, 'A').toUpperCase(),
    supplementName: normalizeString(rawValue?.supplementName),
    gramPerUnit: normalizeNumber(rawValue?.gramPerUnit) ?? 0,
    imageUrl: normalizeString(rawValue?.imageUrl),
    recognizedText: normalizeString(rawValue?.recognizedText),
    confidence: normalizeNumber(rawValue?.confidence) ?? 0,
    nutrients: normalizeNutrientList(rawValue?.nutrients),
    updatedAt: normalizeDateTime(rawValue?.updatedAt, new Date().toISOString()),
  };
}

function normalizeDeviceBindingRecord(rawValue, memberId, options = {}) {
  return {
    id: normalizeString(rawValue?.id, options.idFallback || createId('device')),
    memberId,
    deviceName: normalizeString(rawValue?.deviceName, 'Unknown device'),
    deviceType: normalizeString(rawValue?.deviceType, 'unknown'),
    macAddress: normalizeString(rawValue?.macAddress),
    isConnected: normalizeBoolean(rawValue?.isConnected),
    lastSync: normalizeDateTime(rawValue?.lastSync, new Date().toISOString()),
    lastData: normalizeObject(rawValue?.lastData),
  };
}

function publicMemberRecord(record) {
  const { ownerUserId, ...member } = record;
  return member;
}

function publicSupplementBindingRecord(record) {
  const { ownerUserId, ...binding } = record;
  return binding;
}

function publicDeviceBindingRecord(record) {
  const { ownerUserId, ...binding } = record;
  return binding;
}

function getVersionPolicy() {
  return {
    latestVersion: process.env.AI_HEALTH_LATEST_VERSION || '1.7.0',
    minSupportedVersion: process.env.AI_HEALTH_MIN_VERSION || '1.6.0',
    forceUpdate: process.env.AI_HEALTH_FORCE_UPDATE === 'true',
    changelog: [
      'Dual runtime bootstrap flow with version gating and session restore.',
      'Unified backend APIs for auth, members, plans, devices, and doctor explain.',
      'MySQL-backed persistence with local JSON fallback for demo mode.',
    ],
    downloadUrl:
      process.env.AI_HEALTH_DOWNLOAD_URL || 'https://example.com/ai-health.apk',
  };
}

function buildDoctorFallback(payload) {
  const fusedProfile = payload.fusedHealthProfile || {};
  const nutritionGaps = payload.nutritionGaps || {};
  const latestPlan = payload.latestPlan || {};
  const facts = [];

  if (typeof fusedProfile.heartRate === 'number') {
    facts.push(`心率 ${fusedProfile.heartRate} bpm`);
  }
  if (typeof fusedProfile.steps === 'number') {
    facts.push(`步数 ${fusedProfile.steps}`);
  }
  if (typeof fusedProfile.sleepScore === 'number') {
    facts.push(`睡眠评分 ${Number(fusedProfile.sleepScore).toFixed(0)}`);
  }
  if (typeof fusedProfile.deviceHumidity === 'number') {
    facts.push(`药仓湿度 ${Number(fusedProfile.deviceHumidity).toFixed(1)}%`);
  }
  if (nutritionGaps.deficits && Object.keys(nutritionGaps.deficits).length > 0) {
    facts.push(`营养缺口 ${Object.keys(nutritionGaps.deficits).join('、')}`);
  }
  if (latestPlan.slotAmounts && Object.keys(latestPlan.slotAmounts).length > 0) {
    facts.push(
      `执行槽位 ${Object.entries(latestPlan.slotAmounts)
        .map(([slot, amount]) => `${slot}:${amount}`)
        .join(' ')}`,
    );
  }

  return {
    reply: `我会基于结构化数据解释，不会替代公式计算。当前重点参考了${
      facts.length > 0 ? facts.join('，') : '最近计划与健康快照'
    }。关于“${payload.userMessage || '今日方案'}”，建议先执行刚需补充，再观察睡眠、压力和湿度变化。`,
    warnings: Array.isArray(payload.deviceAlerts) ? payload.deviceAlerts : [],
    referencedFacts: facts,
  };
}

async function callOpenAiDoctor(payload) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return buildDoctorFallback(payload);
  }

  const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content:
            '你是营养决策解释系统。只能基于给定结构化健康数据回答，不得编造新的医学指标，不得给出治疗诊断，只解释营养建议、执行动作与风险提醒。',
        },
        {
          role: 'user',
          content: JSON.stringify(payload, null, 2),
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'doctor_explain',
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['reply', 'warnings', 'referencedFacts'],
            properties: {
              reply: { type: 'string' },
              warnings: {
                type: 'array',
                items: { type: 'string' },
              },
              referencedFacts: {
                type: 'array',
                items: { type: 'string' },
              },
            },
          },
        },
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI request failed: ${response.status} ${detail}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    return buildDoctorFallback(payload);
  }
  return JSON.parse(content);
}

function extractNumericValue(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const value = Number(match[1]);
      if (!Number.isNaN(value)) {
        return value;
      }
    }
  }
  return null;
}

async function ensureMySqlSchema(pool) {
  await pool.execute(
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS current_member_id VARCHAR(64) NULL',
  );
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS members (
      id VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL,
      name VARCHAR(128) NOT NULL,
      avatar TEXT NULL,
      relation VARCHAR(32) NOT NULL DEFAULT 'self',
      birth_date DATETIME NULL,
      gender VARCHAR(32) NULL,
      height DOUBLE NULL,
      weight DOUBLE NULL,
      blood_type VARCHAR(16) NULL,
      allergies_json JSON NOT NULL,
      chronic_diseases_json JSON NOT NULL,
      medications_json JSON NOT NULL,
      is_managed TINYINT(1) NOT NULL DEFAULT 0,
      manager_id VARCHAR(64) NULL,
      extra TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_members_user_updated (user_id, updated_at),
      CONSTRAINT fk_members_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS member_cloud_state (
      user_id VARCHAR(64) NOT NULL,
      member_id VARCHAR(64) NOT NULL,
      payload JSON NOT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, member_id),
      KEY idx_member_cloud_state_updated (user_id, updated_at),
      CONSTRAINT fk_member_cloud_state_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS supplement_box_bindings (
      id VARCHAR(64) PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL,
      member_id VARCHAR(64) NOT NULL,
      box_slot VARCHAR(8) NOT NULL,
      supplement_name VARCHAR(255) NOT NULL,
      gram_per_unit DOUBLE NOT NULL DEFAULT 0,
      image_url TEXT NULL,
      recognized_text TEXT NULL,
      confidence DOUBLE NOT NULL DEFAULT 0,
      nutrients_json JSON NOT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_box_binding_slot (user_id, member_id, box_slot),
      KEY idx_box_binding_member_updated (user_id, member_id, updated_at),
      CONSTRAINT fk_box_bindings_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.execute(
    'ALTER TABLE device_bindings ADD COLUMN IF NOT EXISTS member_id VARCHAR(64) NULL AFTER user_id',
  );
  await pool.execute(
    'ALTER TABLE generated_plans ADD COLUMN IF NOT EXISTS plan_payload JSON NULL AFTER slot_amounts',
  );
}

async function createStorage() {
  const password = process.env.MYSQL_PASSWORD || '';
  if (!password) {
    ensureLocalStore();
    return createLocalStorage();
  }

  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'aihealth',
    password,
    database: process.env.MYSQL_DATABASE || 'ai_health',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: 'utf8mb4',
  });

  await pool.query('SELECT 1');
  await ensureMySqlSchema(pool);
  return createMySqlStorage(pool);
}

function createLocalStorage() {
  return {
    kind: 'local',
    async getUserByEmail(email) {
      const store = readLocalStore();
      return store.users.find((user) => user.email === email) || null;
    },
    async createUser({ email, displayName, password }) {
      const store = readLocalStore();
      if (store.users.some((user) => user.email === email)) {
        return null;
      }
      const user = {
        id: createId('user'),
        email,
        displayName,
        passwordHash: sha256(password),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        currentMemberId: null,
      };
      store.users.push(user);
      writeLocalStore(store);
      return user;
    },
    async getUserByCredentials(email, password) {
      const user = await this.getUserByEmail(email);
      if (!user || user.passwordHash !== sha256(password)) {
        return null;
      }
      return user;
    },
    async createSession(user) {
      const store = readLocalStore();
      const session = {
        token: createId('token'),
        userId: user.id,
        email: user.email,
        displayName: user.displayName,
        mode: 'connectedCloud',
        isDemo: false,
        createdAt: new Date().toISOString(),
      };
      store.sessions.push(session);
      writeLocalStore(store);
      return session;
    },
    async getSession(token) {
      const store = readLocalStore();
      return store.sessions.find((session) => session.token === token) || null;
    },
    async deleteSession(token) {
      const store = readLocalStore();
      store.sessions = store.sessions.filter((session) => session.token !== token);
      writeLocalStore(store);
    },
    async saveHealthLog({ userId, payload }) {
      const store = readLocalStore();
      const record = {
        id: createId('health_log'),
        userId,
        payload,
        createdAt: new Date().toISOString(),
      };
      store.healthDataLog.push(record);
      store.syncEvents.push({
        id: createId('sync'),
        userId,
        eventType: 'health-data',
        payload,
        createdAt: new Date().toISOString(),
      });
      writeLocalStore(store);
      return record;
    },
    async replaceHealthSnapshots({ userId, memberId, snapshots }) {
      const store = readLocalStore();
      store.healthSnapshots = store.healthSnapshots.filter(
        (item) => !(item.userId === userId && item.memberId === memberId),
      );
      const batch = {
        id: createId('snapshot_batch'),
        userId,
        memberId,
        snapshots,
        createdAt: new Date().toISOString(),
      };
      store.healthSnapshots.push(batch);
      store.syncEvents.push({
        id: createId('sync'),
        userId,
        eventType: 'health-snapshots',
        sourceId: memberId,
        payload: batch,
        createdAt: new Date().toISOString(),
      });
      writeLocalStore(store);
      return {
        memberId,
        count: snapshots.length,
      };
    },
    async savePlan(plan) {
      const store = readLocalStore();
      store.plans = store.plans.filter(
        (item) => !(item.userId === plan.userId && item.memberId === plan.memberId),
      );
      store.plans.push(plan);
      store.syncEvents.push({
        id: createId('sync'),
        userId: plan.userId,
        eventType: 'plan-recompute',
        sourceId: plan.memberId,
        payload: plan.planPayload || plan,
        createdAt: new Date().toISOString(),
      });
      const currentState = findLocalCloudState(store, plan.userId, plan.memberId);
      upsertLocalCloudState(store, appendPlanToCloudState(currentState, plan));
      writeLocalStore(store);
      return plan.planPayload || plan;
    },
    async getLatestPlan({ userId, memberId }) {
      const store = readLocalStore();
      const plans = store.plans
        .filter((plan) => plan.userId === userId)
        .filter((plan) => !memberId || plan.memberId === memberId)
        .sort((left, right) => (left.generatedAt < right.generatedAt ? 1 : -1));
      return plans[0] ? plans[0].planPayload || plans[0] : null;
    },
    async saveAnalysisRecord({ type, userId, payload }) {
      const store = readLocalStore();
      const collection = type === 'report' ? store.reports : store.supplements;
      const record = {
        id: createId(type),
        userId,
        payload,
        createdAt: new Date().toISOString(),
      };
      collection.push(record);
      writeLocalStore(store);
      return record;
    },
    async getMembers({ userId }) {
      const store = readLocalStore();
      const members = store.members
        .filter((member) => member.ownerUserId === userId)
        .map(publicMemberRecord)
        .sort((left, right) => (left.createdAt > right.createdAt ? 1 : -1));
      return {
        members,
        currentMemberId: store.currentMemberIds[userId] || null,
      };
    },
    async createMember({ userId, member }) {
      const store = readLocalStore();
      const normalized = {
        ownerUserId: userId,
        ...normalizeMemberRecord(member),
      };
      store.members = store.members.filter(
        (item) => !(item.ownerUserId === userId && item.id === normalized.id),
      );
      store.members.push(normalized);
      if (!store.currentMemberIds[userId]) {
        store.currentMemberIds[userId] = normalized.id;
      }
      writeLocalStore(store);
      return {
        member: publicMemberRecord(normalized),
        currentMemberId: store.currentMemberIds[userId] || null,
      };
    },
    async updateMember({ userId, memberId, member }) {
      const store = readLocalStore();
      const index = store.members.findIndex(
        (item) => item.ownerUserId === userId && item.id === memberId,
      );
      if (index < 0) {
        return null;
      }
      const existing = store.members[index];
      const normalized = {
        ownerUserId: userId,
        ...normalizeMemberRecord(member, {
          idFallback: memberId,
          createdAtFallback: existing.createdAt,
        }),
      };
      store.members[index] = normalized;
      writeLocalStore(store);
      return publicMemberRecord(normalized);
    },
    async deleteMember({ userId, memberId }) {
      const store = readLocalStore();
      const beforeCount = store.members.length;
      store.members = store.members.filter(
        (item) => !(item.ownerUserId === userId && item.id === memberId),
      );
      if (store.members.length === beforeCount) {
        return null;
      }
      store.supplementBoxBindings = store.supplementBoxBindings.filter(
        (item) => !(item.ownerUserId === userId && item.memberId === memberId),
      );
      store.deviceBindings = store.deviceBindings.filter(
        (item) => !(item.ownerUserId === userId && item.memberId === memberId),
      );
      store.memberStates = store.memberStates.filter(
        (item) => !(item.userId === userId && item.memberId === memberId),
      );
      if (store.currentMemberIds[userId] === memberId) {
        const nextMember = store.members.find((item) => item.ownerUserId === userId);
        store.currentMemberIds[userId] = nextMember ? nextMember.id : null;
      }
      writeLocalStore(store);
      return {
        currentMemberId: store.currentMemberIds[userId] || null,
      };
    },
    async setCurrentMember({ userId, memberId }) {
      const store = readLocalStore();
      const exists = store.members.some(
        (item) => item.ownerUserId === userId && item.id === memberId,
      );
      if (!exists) {
        return null;
      }
      store.currentMemberIds[userId] = memberId;
      writeLocalStore(store);
      return memberId;
    },
    async listSupplementBoxBindings({ userId, memberId }) {
      const store = readLocalStore();
      return store.supplementBoxBindings
        .filter((item) => item.ownerUserId === userId && item.memberId === memberId)
        .map(publicSupplementBindingRecord)
        .sort((left, right) => left.boxSlot.localeCompare(right.boxSlot));
    },
    async upsertSupplementBoxBinding({ userId, memberId, binding }) {
      const store = readLocalStore();
      const existing = store.supplementBoxBindings.find(
        (item) =>
          item.ownerUserId === userId &&
          item.memberId === memberId &&
          item.boxSlot === normalizeString(binding.boxSlot, 'A').toUpperCase(),
      );
      const normalized = {
        ownerUserId: userId,
        ...normalizeSupplementBindingRecord(binding, memberId, {
          idFallback: existing?.id,
        }),
      };
      store.supplementBoxBindings = store.supplementBoxBindings.filter(
        (item) =>
          !(item.ownerUserId === userId &&
            item.memberId === memberId &&
            item.boxSlot === normalized.boxSlot),
      );
      store.supplementBoxBindings.push(normalized);
      writeLocalStore(store);
      return publicSupplementBindingRecord(normalized);
    },
    async listDeviceBindings({ userId, memberId }) {
      const store = readLocalStore();
      return store.deviceBindings
        .filter((item) => item.ownerUserId === userId && item.memberId === memberId)
        .map(publicDeviceBindingRecord)
        .sort((left, right) => (left.lastSync < right.lastSync ? -1 : 1));
    },
    async upsertDeviceBinding({ userId, memberId, binding }) {
      const store = readLocalStore();
      const normalized = {
        ownerUserId: userId,
        ...normalizeDeviceBindingRecord(binding, memberId),
      };
      store.deviceBindings = store.deviceBindings.filter(
        (item) => !(item.ownerUserId === userId && item.id === normalized.id),
      );
      store.deviceBindings.push(normalized);
      writeLocalStore(store);
      return publicDeviceBindingRecord(normalized);
    },
    async listCloudMembers({ userId }) {
      const directory = await this.getMembers({ userId });
      return directory.members;
    },
    async upsertCloudMember({ userId, memberId, memberProfile }) {
      const store = readLocalStore();
      const existing = store.members.find(
        (item) => item.ownerUserId === userId && item.id === memberId,
      );
      const normalized = {
        ownerUserId: userId,
        ...normalizeMemberRecord(memberProfile, {
          idFallback: memberId,
          createdAtFallback: existing?.createdAt,
        }),
      };
      store.members = store.members.filter(
        (item) => !(item.ownerUserId === userId && item.id === memberId),
      );
      store.members.push(normalized);
      const currentState = findLocalCloudState(store, userId, memberId);
      upsertLocalCloudState(
        store,
        mergeCloudState(
          currentState,
          {
            memberProfile: publicMemberRecord(normalized),
          },
          { userId, memberId },
        ),
      );
      writeLocalStore(store);
      return publicMemberRecord(normalized);
    },
    async getCloudState({ userId, memberId }) {
      const store = readLocalStore();
      return findLocalCloudState(store, userId, memberId);
    },
    async patchCloudState({ userId, memberId, patch }) {
      const store = readLocalStore();
      const currentState = findLocalCloudState(store, userId, memberId);
      const nextState = mergeCloudState(currentState, patch, { userId, memberId });
      upsertLocalCloudState(store, nextState);
      writeLocalStore(store);
      return nextState;
    },
  };
}


function mapUserRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: normalizeString(row.id),
    email: normalizeString(row.email),
    displayName: normalizeString(row.display_name || row.displayName),
    passwordHash: normalizeString(row.password_hash || row.passwordHash),
    createdAt: normalizeDateTime(row.created_at || row.createdAt, new Date().toISOString()),
    updatedAt: normalizeDateTime(row.updated_at || row.updatedAt, new Date().toISOString()),
    currentMemberId: normalizeNullableString(
      row.current_member_id ?? row.currentMemberId ?? null,
    ),
  };
}

function mapSessionRow(row) {
  if (!row) {
    return null;
  }
  return {
    token: normalizeString(row.token),
    userId: normalizeString(row.user_id || row.userId),
    email: normalizeString(row.email),
    displayName: normalizeString(row.display_name || row.displayName),
    mode: normalizeString(row.mode, 'connectedCloud'),
    isDemo: normalizeBoolean(row.is_demo ?? row.isDemo),
    createdAt: normalizeDateTime(row.created_at || row.createdAt, new Date().toISOString()),
  };
}

function mapMemberRow(row) {
  if (!row) {
    return null;
  }
  return normalizeMemberRecord({
    id: row.id,
    name: row.name,
    avatar: row.avatar,
    relation: row.relation,
    birthDate: row.birth_date || row.birthDate,
    gender: row.gender,
    height: row.height,
    weight: row.weight,
    bloodType: row.blood_type || row.bloodType,
    allergies: parseJsonField(row.allergies_json || row.allergiesJson, []),
    chronicDiseases: parseJsonField(
      row.chronic_diseases_json || row.chronicDiseasesJson,
      [],
    ),
    medications: parseJsonField(row.medications_json || row.medicationsJson, []),
    isManaged: row.is_managed ?? row.isManaged,
    managerId: row.manager_id || row.managerId,
    extra: row.extra,
    createdAt: row.created_at || row.createdAt,
    updatedAt: row.updated_at || row.updatedAt,
  });
}

function mapSupplementBindingRow(row) {
  if (!row) {
    return null;
  }
  return normalizeSupplementBindingRecord(
    {
      id: row.id,
      boxSlot: row.box_slot || row.boxSlot,
      supplementName: row.supplement_name || row.supplementName,
      gramPerUnit: row.gram_per_unit || row.gramPerUnit,
      imageUrl: row.image_url || row.imageUrl,
      recognizedText: row.recognized_text || row.recognizedText,
      confidence: row.confidence,
      nutrients: parseJsonField(row.nutrients_json || row.nutrientsJson, []),
      updatedAt: row.updated_at || row.updatedAt,
    },
    normalizeString(row.member_id || row.memberId),
    { idFallback: row.id },
  );
}

function mapDeviceBindingRow(row) {
  if (!row) {
    return null;
  }
  return normalizeDeviceBindingRecord(
    {
      id: row.id,
      deviceName: row.device_name || row.deviceName,
      deviceType: row.device_type || row.deviceType,
      macAddress: row.mac_address || row.macAddress,
      isConnected: row.is_connected ?? row.isConnected,
      lastSync: row.last_sync || row.lastSync,
      lastData: parseJsonField(row.last_data || row.lastData, {}),
    },
    normalizeString(row.member_id || row.memberId),
    { idFallback: row.id },
  );
}

function mapPlanRow(row) {
  if (!row) {
    return null;
  }
  return buildPlanResponseFromRecord({
    id: row.id,
    userId: row.user_id || row.userId,
    memberId: row.member_id || row.memberId,
    source: row.source,
    calorieTarget: row.calorie_target || row.calorieTarget,
    slotAmounts: row.slot_amounts || row.slotAmounts,
    planPayload: row.plan_payload || row.planPayload,
    summary: row.summary,
    generatedAt: row.generated_at || row.generatedAt,
  });
}

function buildReportAnalysis({ imageUrl, reportType, ocrText }) {
  const recognizedText = normalizeString(ocrText);
  const weightKg = extractNumericValue(recognizedText, [
    /weight[^0-9]{0,12}([0-9]+(?:\.[0-9]+)?)/i,
    /body\s*weight[^0-9]{0,12}([0-9]+(?:\.[0-9]+)?)/i,
    /体重[^0-9]{0,12}([0-9]+(?:\.[0-9]+)?)/,
  ]);
  const bodyFatPercent = extractNumericValue(recognizedText, [
    /body\s*fat[^0-9]{0,12}([0-9]+(?:\.[0-9]+)?)/i,
    /fat\s*%[^0-9]{0,12}([0-9]+(?:\.[0-9]+)?)/i,
    /体脂[^0-9]{0,12}([0-9]+(?:\.[0-9]+)?)/,
  ]);
  const muscleMassKg = extractNumericValue(recognizedText, [
    /muscle[^0-9]{0,12}([0-9]+(?:\.[0-9]+)?)/i,
    /skeletal[^0-9]{0,12}([0-9]+(?:\.[0-9]+)?)/i,
    /肌肉[^0-9]{0,12}([0-9]+(?:\.[0-9]+)?)/,
  ]);
  const waterRatioPercent = extractNumericValue(recognizedText, [
    /water[^0-9]{0,12}([0-9]+(?:\.[0-9]+)?)/i,
    /hydration[^0-9]{0,12}([0-9]+(?:\.[0-9]+)?)/i,
    /水分[^0-9]{0,12}([0-9]+(?:\.[0-9]+)?)/,
  ]);
  const bmi = extractNumericValue(recognizedText, [/bmi[^0-9]{0,12}([0-9]+(?:\.[0-9]+)?)/i]);
  const bmrKcal = extractNumericValue(recognizedText, [
    /bmr[^0-9]{0,12}([0-9]+(?:\.[0-9]+)?)/i,
    /basal[^0-9]{0,12}([0-9]+(?:\.[0-9]+)?)/i,
  ]);
  const visceralFatLevel = extractNumericValue(recognizedText, [
    /visceral[^0-9]{0,12}([0-9]+(?:\.[0-9]+)?)/i,
    /内脏脂肪[^0-9]{0,12}([0-9]+(?:\.[0-9]+)?)/,
  ]);
  const leanMassKg = extractNumericValue(recognizedText, [
    /lean[^0-9]{0,12}([0-9]+(?:\.[0-9]+)?)/i,
    /fat\s*free[^0-9]{0,12}([0-9]+(?:\.[0-9]+)?)/i,
    /去脂体重[^0-9]{0,12}([0-9]+(?:\.[0-9]+)?)/,
  ]);

  const populatedCount = [
    weightKg,
    bodyFatPercent,
    muscleMassKg,
    waterRatioPercent,
    bmi,
    bmrKcal,
    visceralFatLevel,
    leanMassKg,
  ].filter((item) => item != null).length;
  const confidence =
    populatedCount === 0 ? 0.35 : Math.min(0.95, 0.45 + populatedCount * 0.07);

  return {
    reportType: normalizeString(reportType, 'body_fat_report'),
    imageUrl: normalizeString(imageUrl),
    weightKg,
    bodyFatPercent,
    muscleMassKg,
    waterRatioPercent,
    bmi,
    bmrKcal,
    visceralFatLevel,
    leanMassKg,
    confidence: Number(confidence.toFixed(2)),
    recognizedText,
  };
}

function detectSupplementName(text) {
  const source = normalizeString(text).trim();
  if (!source) {
    return 'Pending supplement';
  }

  const knownSupplements = [
    ['vitamin c', 'Vitamin C'],
    ['vitamin d', 'Vitamin D'],
    ['omega', 'Omega-3'],
    ['fish oil', 'Fish Oil'],
    ['magnesium', 'Magnesium'],
    ['iron', 'Iron'],
    ['zinc', 'Zinc'],
    ['creatine', 'Creatine'],
    ['protein', 'Protein'],
    ['胶原蛋白', 'Collagen'],
    ['维生素c', 'Vitamin C'],
    ['维生素d', 'Vitamin D'],
    ['鱼油', 'Fish Oil'],
    ['镁', 'Magnesium'],
    ['铁', 'Iron'],
    ['锌', 'Zinc'],
    ['肌酸', 'Creatine'],
    ['蛋白', 'Protein'],
  ];

  const lowered = source.toLowerCase();
  for (const [needle, label] of knownSupplements) {
    if (lowered.includes(needle)) {
      return label;
    }
  }

  const firstLine = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 2);
  return firstLine || 'Pending supplement';
}

function buildSupplementAnalysis({ imageUrl, ocrText }) {
  const recognizedText = normalizeString(ocrText);
  const supplementName = detectSupplementName(recognizedText);
  const gramPerServing = extractNumericValue(recognizedText, [
    /serving[^0-9]{0,12}([0-9]+(?:\.[0-9]+)?)\s*g/i,
    /per\s*unit[^0-9]{0,12}([0-9]+(?:\.[0-9]+)?)\s*g/i,
    /每份[^0-9]{0,12}([0-9]+(?:\.[0-9]+)?)/,
    /([0-9]+(?:\.[0-9]+)?)\s*g/i,
  ]);
  const nutrientPatterns = [
    ['Protein', /protein[^0-9]{0,12}([0-9]+(?:\.[0-9]+)?)/i, 'g'],
    ['Vitamin C', /vitamin\s*c[^0-9]{0,12}([0-9]+(?:\.[0-9]+)?)/i, 'mg'],
    ['Vitamin D', /vitamin\s*d[^0-9]{0,12}([0-9]+(?:\.[0-9]+)?)/i, 'IU'],
    ['Magnesium', /magnesium[^0-9]{0,12}([0-9]+(?:\.[0-9]+)?)/i, 'mg'],
    ['Iron', /iron[^0-9]{0,12}([0-9]+(?:\.[0-9]+)?)/i, 'mg'],
    ['Omega-3', /omega[^0-9]{0,12}([0-9]+(?:\.[0-9]+)?)/i, 'mg'],
  ];
  const nutrients = [];
  for (const [name, pattern, unit] of nutrientPatterns) {
    const amount = extractNumericValue(recognizedText, [pattern]);
    if (amount != null) {
      nutrients.push({ name, amount, unit });
    }
  }
  if (nutrients.length === 0 && gramPerServing != null) {
    nutrients.push({
      name: supplementName,
      amount: gramPerServing,
      unit: 'g',
    });
  }

  const confidenceBase = supplementName === 'Pending supplement' ? 0.42 : 0.64;
  const confidence = Math.min(
    0.96,
    confidenceBase + (gramPerServing != null ? 0.12 : 0) + nutrients.length * 0.04,
  );

  return {
    imageUrl: normalizeString(imageUrl),
    supplementName,
    gramPerServing,
    confidence: Number(confidence.toFixed(2)),
    recognizedEvidence: recognizedText,
    nutrients,
  };
}

function createMySqlStorage(pool) {
  async function getCurrentMemberId(userId) {
    const [rows] = await pool.execute(
      'SELECT current_member_id FROM users WHERE id = ? LIMIT 1',
      [userId],
    );
    return rows[0] ? normalizeNullableString(rows[0].current_member_id) : null;
  }

  async function selectMember(userId, memberId) {
    const [rows] = await pool.execute(
      `
        SELECT
          id,
          user_id,
          name,
          avatar,
          relation,
          birth_date,
          gender,
          height,
          weight,
          blood_type,
          allergies_json,
          chronic_diseases_json,
          medications_json,
          is_managed,
          manager_id,
          extra,
          created_at,
          updated_at
        FROM members
        WHERE user_id = ? AND id = ?
        LIMIT 1
      `,
      [userId, memberId],
    );
    return rows[0] ? mapMemberRow(rows[0]) : null;
  }

  async function upsertMember(userId, memberId, member, options = {}) {
    const existing = options.existing || (await selectMember(userId, memberId));
    const normalized = normalizeMemberRecord(member, {
      idFallback: memberId,
      createdAtFallback: existing?.createdAt,
    });
    await pool.execute(
      `
        INSERT INTO members (
          id,
          user_id,
          name,
          avatar,
          relation,
          birth_date,
          gender,
          height,
          weight,
          blood_type,
          allergies_json,
          chronic_diseases_json,
          medications_json,
          is_managed,
          manager_id,
          extra,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          user_id = VALUES(user_id),
          name = VALUES(name),
          avatar = VALUES(avatar),
          relation = VALUES(relation),
          birth_date = VALUES(birth_date),
          gender = VALUES(gender),
          height = VALUES(height),
          weight = VALUES(weight),
          blood_type = VALUES(blood_type),
          allergies_json = VALUES(allergies_json),
          chronic_diseases_json = VALUES(chronic_diseases_json),
          medications_json = VALUES(medications_json),
          is_managed = VALUES(is_managed),
          manager_id = VALUES(manager_id),
          extra = VALUES(extra),
          updated_at = VALUES(updated_at)
      `,
      [
        normalized.id,
        userId,
        normalized.name,
        normalized.avatar,
        normalized.relation,
        normalized.birthDate ? toMySqlDateTime(normalized.birthDate) : null,
        normalized.gender,
        normalized.height,
        normalized.weight,
        normalized.bloodType,
        JSON.stringify(normalized.allergies),
        JSON.stringify(normalized.chronicDiseases),
        JSON.stringify(normalized.medications),
        normalized.isManaged ? 1 : 0,
        normalized.managerId,
        normalized.extra,
        toMySqlDateTime(normalized.createdAt),
        toMySqlDateTime(normalized.updatedAt),
      ],
    );
    return normalized;
  }

  async function readCloudState(userId, memberId) {
    const [rows] = await pool.execute(
      'SELECT payload FROM member_cloud_state WHERE user_id = ? AND member_id = ? LIMIT 1',
      [userId, memberId],
    );
    if (rows[0]) {
      return normalizeCloudState(parseJsonField(rows[0].payload, null), {
        userId,
        memberId,
      });
    }

    const memberProfile = await selectMember(userId, memberId);
    if (!memberProfile) {
      return null;
    }
    return normalizeCloudState(
      {
        userId,
        memberId,
        memberProfile,
      },
      { userId, memberId },
    );
  }

  async function writeCloudState(userId, memberId, state) {
    const normalized = normalizeCloudState(state, { userId, memberId });
    await pool.execute(
      `
        INSERT INTO member_cloud_state (user_id, member_id, payload, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON DUPLICATE KEY UPDATE
          payload = VALUES(payload),
          updated_at = CURRENT_TIMESTAMP
      `,
      [userId, memberId, JSON.stringify(normalized)],
    );
    return normalized;
  }

  async function syncMemberProfileIntoState(userId, member) {
    const memberProfile = publicMemberRecord(member);
    const currentState = await readCloudState(userId, member.id);
    return writeCloudState(
      userId,
      member.id,
      mergeCloudState(currentState, { memberProfile }, { userId, memberId: member.id }),
    );
  }

  async function recordSyncEvent(userId, eventType, sourceId, payload) {
    await pool.execute(
      `
        INSERT INTO sync_events (user_id, event_type, source_id, payload)
        VALUES (?, ?, ?, ?)
      `,
      [userId, eventType, sourceId || null, payload == null ? null : JSON.stringify(payload)],
    );
  }

  return {
    kind: 'mysql',
    async getUserByEmail(email) {
      const [rows] = await pool.execute(
        `
          SELECT
            id,
            email,
            display_name,
            password_hash,
            created_at,
            updated_at,
            current_member_id
          FROM users
          WHERE email = ?
          LIMIT 1
        `,
        [email],
      );
      return rows[0] ? mapUserRow(rows[0]) : null;
    },
    async createUser({ email, displayName, password }) {
      const existing = await this.getUserByEmail(email);
      if (existing) {
        return null;
      }

      const user = {
        id: createId('user'),
        email: normalizeString(email).toLowerCase(),
        displayName: normalizeString(displayName, 'AI Health User'),
        passwordHash: sha256(password),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        currentMemberId: null,
      };
      await pool.execute(
        `
          INSERT INTO users (
            id,
            email,
            display_name,
            password_hash,
            created_at,
            updated_at,
            current_member_id
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        [
          user.id,
          user.email,
          user.displayName,
          user.passwordHash,
          toMySqlDateTime(user.createdAt),
          toMySqlDateTime(user.updatedAt),
          null,
        ],
      );
      return user;
    },
    async getUserByCredentials(email, password) {
      const user = await this.getUserByEmail(email);
      if (!user || user.passwordHash !== sha256(password)) {
        return null;
      }
      return user;
    },
    async createSession(user) {
      const session = {
        token: createId('token'),
        userId: user.id,
        email: user.email,
        displayName: user.displayName,
        mode: 'connectedCloud',
        isDemo: false,
        createdAt: new Date().toISOString(),
      };
      await pool.execute(
        `
          INSERT INTO auth_sessions (
            token,
            user_id,
            email,
            display_name,
            mode,
            is_demo,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        [
          session.token,
          session.userId,
          session.email,
          session.displayName,
          session.mode,
          session.isDemo ? 1 : 0,
          toMySqlDateTime(session.createdAt),
        ],
      );
      return session;
    },
    async getSession(token) {
      const [rows] = await pool.execute(
        `
          SELECT
            token,
            user_id,
            email,
            display_name,
            mode,
            is_demo,
            created_at
          FROM auth_sessions
          WHERE token = ?
          LIMIT 1
        `,
        [token],
      );
      return rows[0] ? mapSessionRow(rows[0]) : null;
    },
    async deleteSession(token) {
      await pool.execute('DELETE FROM auth_sessions WHERE token = ?', [token]);
    },
    async saveHealthLog({ userId, payload }) {
      const [result] = await pool.execute(
        `
          INSERT INTO health_data_log (user_id, payload)
          VALUES (?, ?)
        `,
        [userId, JSON.stringify(payload)],
      );
      await recordSyncEvent(userId, 'health-data', null, payload);
      return {
        id: normalizeString(result.insertId),
        userId,
        payload,
        createdAt: new Date().toISOString(),
      };
    },
    async replaceHealthSnapshots({ userId, memberId, snapshots }) {
      await pool.execute(
        'DELETE FROM health_snapshots WHERE user_id = ? AND member_id = ?',
        [userId, memberId],
      );
      for (const snapshot of Array.isArray(snapshots) ? snapshots : []) {
        await pool.execute(
          `
            INSERT INTO health_snapshots (
              id,
              user_id,
              member_id,
              provider,
              metric_type,
              priority,
              source_id,
              normalized_data,
              raw_payload,
              collected_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            normalizeString(snapshot.id, createId('snapshot')),
            userId,
            memberId,
            normalizeString(snapshot.provider),
            normalizeString(snapshot.metricType),
            normalizeString(snapshot.priority, 'medium'),
            normalizeNullableString(snapshot.sourceId),
            JSON.stringify(normalizeObject(snapshot.normalizedData)),
            JSON.stringify(normalizeObject(snapshot.rawPayload)),
            toMySqlDateTime(snapshot.collectedAt || new Date()),
          ],
        );
      }
      await recordSyncEvent(userId, 'health-snapshots', memberId, snapshots);
      return {
        memberId,
        count: Array.isArray(snapshots) ? snapshots.length : 0,
      };
    },
    async savePlan(plan) {
      const payload = isPlainObject(plan.planPayload) ? plan.planPayload : plan;
      await pool.execute(
        `
          INSERT INTO generated_plans (
            id,
            user_id,
            member_id,
            source,
            calorie_target,
            slot_amounts,
            plan_payload,
            summary,
            generated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            user_id = VALUES(user_id),
            member_id = VALUES(member_id),
            source = VALUES(source),
            calorie_target = VALUES(calorie_target),
            slot_amounts = VALUES(slot_amounts),
            plan_payload = VALUES(plan_payload),
            summary = VALUES(summary),
            generated_at = VALUES(generated_at)
        `,
        [
          normalizeString(plan.id, payload.id || createId('plan')),
          normalizeString(plan.userId),
          normalizeString(plan.memberId),
          normalizeString(plan.source, 'mysql'),
          normalizeNumber(plan.calorieTarget) ?? 0,
          JSON.stringify(normalizeObject(plan.slotAmounts)),
          JSON.stringify(payload),
          normalizeString(plan.summary),
          toMySqlDateTime(plan.generatedAt || new Date()),
        ],
      );
      const currentState = await readCloudState(plan.userId, plan.memberId);
      await writeCloudState(
        plan.userId,
        plan.memberId,
        appendPlanToCloudState(currentState, {
          ...plan,
          planPayload: payload,
          slotAmounts: normalizeObject(plan.slotAmounts),
        }),
      );
      await recordSyncEvent(plan.userId, 'plan-recompute', plan.memberId, payload);
      return payload;
    },
    async getLatestPlan({ userId, memberId }) {
      const params = [userId];
      let sql = `
        SELECT
          id,
          user_id,
          member_id,
          source,
          calorie_target,
          slot_amounts,
          plan_payload,
          summary,
          generated_at
        FROM generated_plans
        WHERE user_id = ?
      `;
      if (memberId) {
        sql += ' AND member_id = ?';
        params.push(memberId);
      }
      sql += ' ORDER BY generated_at DESC, created_at DESC LIMIT 1';
      const [rows] = await pool.execute(sql, params);
      return rows[0] ? mapPlanRow(rows[0]) : null;
    },
    async saveAnalysisRecord({ type, userId, payload }) {
      const record = {
        id: createId(type),
        userId,
        recordType: normalizeString(type),
        payload,
        createdAt: new Date().toISOString(),
      };
      await pool.execute(
        `
          INSERT INTO analysis_records (id, user_id, record_type, payload, created_at)
          VALUES (?, ?, ?, ?, ?)
        `,
        [
          record.id,
          record.userId,
          record.recordType,
          JSON.stringify(record.payload),
          toMySqlDateTime(record.createdAt),
        ],
      );
      return record;
    },
    async getMembers({ userId }) {
      const currentMemberId = await getCurrentMemberId(userId);
      const [rows] = await pool.execute(
        `
          SELECT
            id,
            user_id,
            name,
            avatar,
            relation,
            birth_date,
            gender,
            height,
            weight,
            blood_type,
            allergies_json,
            chronic_diseases_json,
            medications_json,
            is_managed,
            manager_id,
            extra,
            created_at,
            updated_at
          FROM members
          WHERE user_id = ?
          ORDER BY created_at ASC
        `,
        [userId],
      );
      return {
        members: rows.map(mapMemberRow),
        currentMemberId,
      };
    },
    async createMember({ userId, member }) {
      const normalized = await upsertMember(
        userId,
        normalizeString(member?.id, createId('member')),
        member,
      );
      const currentMemberId = (await getCurrentMemberId(userId)) || normalized.id;
      if (currentMemberId === normalized.id) {
        await pool.execute(
          'UPDATE users SET current_member_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          [normalized.id, userId],
        );
      }
      await syncMemberProfileIntoState(userId, normalized);
      return {
        member: normalized,
        currentMemberId: (await getCurrentMemberId(userId)) || normalized.id,
      };
    },
    async updateMember({ userId, memberId, member }) {
      const existing = await selectMember(userId, memberId);
      if (!existing) {
        return null;
      }
      const normalized = await upsertMember(userId, memberId, member, { existing });
      await syncMemberProfileIntoState(userId, normalized);
      return normalized;
    },
    async deleteMember({ userId, memberId }) {
      const [result] = await pool.execute(
        'DELETE FROM members WHERE user_id = ? AND id = ?',
        [userId, memberId],
      );
      if (!result.affectedRows) {
        return null;
      }
      await pool.execute(
        'DELETE FROM supplement_box_bindings WHERE user_id = ? AND member_id = ?',
        [userId, memberId],
      );
      await pool.execute(
        'DELETE FROM device_bindings WHERE user_id = ? AND member_id = ?',
        [userId, memberId],
      );
      await pool.execute(
        'DELETE FROM member_cloud_state WHERE user_id = ? AND member_id = ?',
        [userId, memberId],
      );
      await pool.execute(
        'DELETE FROM generated_plans WHERE user_id = ? AND member_id = ?',
        [userId, memberId],
      );
      await pool.execute(
        'DELETE FROM health_snapshots WHERE user_id = ? AND member_id = ?',
        [userId, memberId],
      );

      const currentMemberId = await getCurrentMemberId(userId);
      if (currentMemberId === memberId) {
        const [nextRows] = await pool.execute(
          'SELECT id FROM members WHERE user_id = ? ORDER BY created_at ASC LIMIT 1',
          [userId],
        );
        const nextMemberId = nextRows[0] ? normalizeNullableString(nextRows[0].id) : null;
        await pool.execute(
          'UPDATE users SET current_member_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          [nextMemberId, userId],
        );
        return { currentMemberId: nextMemberId };
      }

      return { currentMemberId };
    },
    async setCurrentMember({ userId, memberId }) {
      const existing = await selectMember(userId, memberId);
      if (!existing) {
        return null;
      }
      await pool.execute(
        'UPDATE users SET current_member_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [memberId, userId],
      );
      return memberId;
    },
    async listSupplementBoxBindings({ userId, memberId }) {
      const [rows] = await pool.execute(
        `
          SELECT
            id,
            user_id,
            member_id,
            box_slot,
            supplement_name,
            gram_per_unit,
            image_url,
            recognized_text,
            confidence,
            nutrients_json,
            updated_at
          FROM supplement_box_bindings
          WHERE user_id = ? AND member_id = ?
          ORDER BY box_slot ASC
        `,
        [userId, memberId],
      );
      return rows.map(mapSupplementBindingRow);
    },
    async upsertSupplementBoxBinding({ userId, memberId, binding }) {
      const [existingRows] = await pool.execute(
        `
          SELECT id
          FROM supplement_box_bindings
          WHERE user_id = ? AND member_id = ? AND box_slot = ?
          LIMIT 1
        `,
        [userId, memberId, normalizeString(binding.boxSlot, 'A').toUpperCase()],
      );
      const normalized = normalizeSupplementBindingRecord(binding, memberId, {
        idFallback: existingRows[0] ? existingRows[0].id : undefined,
      });
      await pool.execute(
        `
          INSERT INTO supplement_box_bindings (
            id,
            user_id,
            member_id,
            box_slot,
            supplement_name,
            gram_per_unit,
            image_url,
            recognized_text,
            confidence,
            nutrients_json,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            id = VALUES(id),
            supplement_name = VALUES(supplement_name),
            gram_per_unit = VALUES(gram_per_unit),
            image_url = VALUES(image_url),
            recognized_text = VALUES(recognized_text),
            confidence = VALUES(confidence),
            nutrients_json = VALUES(nutrients_json),
            updated_at = VALUES(updated_at)
        `,
        [
          normalized.id,
          userId,
          memberId,
          normalized.boxSlot,
          normalized.supplementName,
          normalized.gramPerUnit,
          normalized.imageUrl,
          normalized.recognizedText,
          normalized.confidence,
          JSON.stringify(normalized.nutrients),
          toMySqlDateTime(normalized.updatedAt),
        ],
      );
      return normalized;
    },
    async listDeviceBindings({ userId, memberId }) {
      const [rows] = await pool.execute(
        `
          SELECT
            id,
            user_id,
            member_id,
            device_name,
            device_type,
            mac_address,
            is_connected,
            last_sync,
            last_data
          FROM device_bindings
          WHERE user_id = ? AND member_id = ?
          ORDER BY last_sync DESC
        `,
        [userId, memberId],
      );
      return rows.map(mapDeviceBindingRow);
    },
    async upsertDeviceBinding({ userId, memberId, binding }) {
      const normalized = normalizeDeviceBindingRecord(binding, memberId, {
        idFallback: binding?.id,
      });
      await pool.execute(
        `
          INSERT INTO device_bindings (
            id,
            user_id,
            member_id,
            device_name,
            device_type,
            mac_address,
            is_connected,
            last_sync,
            last_data
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            user_id = VALUES(user_id),
            member_id = VALUES(member_id),
            device_name = VALUES(device_name),
            device_type = VALUES(device_type),
            mac_address = VALUES(mac_address),
            is_connected = VALUES(is_connected),
            last_sync = VALUES(last_sync),
            last_data = VALUES(last_data)
        `,
        [
          normalized.id,
          userId,
          memberId,
          normalized.deviceName,
          normalized.deviceType,
          normalized.macAddress,
          normalized.isConnected ? 1 : 0,
          toMySqlDateTime(normalized.lastSync),
          JSON.stringify(normalized.lastData),
        ],
      );
      return normalized;
    },
    async listCloudMembers({ userId }) {
      const directory = await this.getMembers({ userId });
      return directory.members;
    },
    async upsertCloudMember({ userId, memberId, memberProfile }) {
      const normalized = await upsertMember(userId, memberId, memberProfile);
      await syncMemberProfileIntoState(userId, normalized);
      return normalized;
    },
    async getCloudState({ userId, memberId }) {
      return readCloudState(userId, memberId);
    },
    async patchCloudState({ userId, memberId, patch }) {
      let safePatch = isPlainObject(patch) ? { ...patch } : {};
      if (isPlainObject(safePatch.memberProfile)) {
        const normalizedMember = await upsertMember(userId, memberId, safePatch.memberProfile);
        safePatch = {
          ...safePatch,
          memberProfile: publicMemberRecord(normalizedMember),
        };
      }
      const currentState = await readCloudState(userId, memberId);
      const nextState = mergeCloudState(currentState, safePatch, { userId, memberId });
      await writeCloudState(userId, memberId, nextState);
      return nextState;
    },
  };
}

function readAuthToken(request) {
  const header = request.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return '';
  }
  return header.slice('Bearer '.length).trim();
}

let bootstrapPromise = null;
let routesRegistered = false;
let activeServer = null;

function registerRoutes(storage) {
  if (routesRegistered) {
    return;
  }
  routesRegistered = true;

  async function requireAuth(request, response, next) {
    try {
      const token = readAuthToken(request);
      if (!token) {
        response.status(401).json({ error: 'Missing bearer token.' });
        return;
      }

      const session = await storage.getSession(token);
      if (!session) {
        response.status(401).json({ error: 'Session expired.' });
        return;
      }

      request.auth = session;
      next();
    } catch (error) {
      next(error);
    }
  }

  app.get('/api/version', (request, response) => {
    response.json({
      ...getVersionPolicy(),
      storage: storage.kind,
      serverTime: new Date().toISOString(),
    });
  });

  app.get('/api/version/latest', (request, response) => {
    response.json(getVersionPolicy());
  });

  app.post('/api/auth/register', async (request, response, next) => {
    try {
      const body = normalizeObject(request.body);
      const email = normalizeString(body.email).toLowerCase();
      const password = normalizeString(body.password);
      const displayName = normalizeString(body.displayName, email.split('@')[0] || 'AI Health');
      if (!email || !password) {
        response.status(400).json({ error: 'email and password are required.' });
        return;
      }

      const user = await storage.createUser({ email, displayName, password });
      if (!user) {
        response.status(409).json({ error: 'Email already exists.' });
        return;
      }

      const session = await storage.createSession(user);
      response.status(201).json({
        session,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/auth/login', async (request, response, next) => {
    try {
      const body = normalizeObject(request.body);
      const email = normalizeString(body.email).toLowerCase();
      const password = normalizeString(body.password);
      const user = await storage.getUserByCredentials(email, password);
      if (!user) {
        response.status(401).json({ error: 'Invalid email or password.' });
        return;
      }

      const session = await storage.createSession(user);
      response.json({
        session,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/auth/session', requireAuth, async (request, response) => {
    response.json({
      session: request.auth,
    });
  });

  app.post('/api/auth/logout', requireAuth, async (request, response, next) => {
    try {
      await storage.deleteSession(request.auth.token);
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/members', requireAuth, async (request, response, next) => {
    try {
      response.json(
        await storage.getMembers({
          userId: request.auth.userId,
        }),
      );
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/members', requireAuth, async (request, response, next) => {
    try {
      response.status(201).json(
        await storage.createMember({
          userId: request.auth.userId,
          member: normalizeObject(request.body),
        }),
      );
    } catch (error) {
      next(error);
    }
  });

  app.put('/api/members/:memberId', requireAuth, async (request, response, next) => {
    try {
      const member = await storage.updateMember({
        userId: request.auth.userId,
        memberId: normalizeString(request.params.memberId),
        member: normalizeObject(request.body),
      });
      if (!member) {
        response.status(404).json({ error: 'Member not found.' });
        return;
      }
      response.json(member);
    } catch (error) {
      next(error);
    }
  });

  app.delete('/api/members/:memberId', requireAuth, async (request, response, next) => {
    try {
      const result = await storage.deleteMember({
        userId: request.auth.userId,
        memberId: normalizeString(request.params.memberId),
      });
      if (!result) {
        response.status(404).json({ error: 'Member not found.' });
        return;
      }
      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/members/:memberId/select', requireAuth, async (request, response, next) => {
    try {
      const currentMemberId = await storage.setCurrentMember({
        userId: request.auth.userId,
        memberId: normalizeString(request.params.memberId),
      });
      if (!currentMemberId) {
        response.status(404).json({ error: 'Member not found.' });
        return;
      }
      response.json({ currentMemberId });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/cloud/members', requireAuth, async (request, response, next) => {
    try {
      response.json({
        members: await storage.listCloudMembers({
          userId: request.auth.userId,
        }),
      });
    } catch (error) {
      next(error);
    }
  });

  app.put('/api/cloud/members/:memberId', requireAuth, async (request, response, next) => {
    try {
      const body = normalizeObject(request.body);
      const member = await storage.upsertCloudMember({
        userId: request.auth.userId,
        memberId: normalizeString(request.params.memberId),
        memberProfile: normalizeObject(body.memberProfile),
      });
      response.json({ member });
    } catch (error) {
      next(error);
    }
  });
  app.get('/api/cloud/state', requireAuth, async (request, response, next) => {
    try {
      const memberId = normalizeString(request.query.memberId);
      if (!memberId) {
        response.status(400).json({ error: 'memberId is required.' });
        return;
      }

      const state = await storage.getCloudState({
        userId: request.auth.userId,
        memberId,
      });
      if (!state) {
        response.status(404).json({ error: 'Cloud state not found.' });
        return;
      }
      response.json(state);
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/cloud/state', requireAuth, async (request, response, next) => {
    try {
      const body = normalizeObject(request.body);
      const memberId = normalizeString(body.memberId);
      if (!memberId) {
        response.status(400).json({ error: 'memberId is required.' });
        return;
      }

      const state = await storage.patchCloudState({
        userId: request.auth.userId,
        memberId,
        patch: normalizeObject(body.state),
      });
      response.json(state);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/supplement-box-bindings', requireAuth, async (request, response, next) => {
    try {
      const memberId = normalizeString(request.query.memberId);
      if (!memberId) {
        response.status(400).json({ error: 'memberId is required.' });
        return;
      }
      response.json({
        bindings: await storage.listSupplementBoxBindings({
          userId: request.auth.userId,
          memberId,
        }),
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/supplement-box-bindings', requireAuth, async (request, response, next) => {
    try {
      const body = normalizeObject(request.body);
      const memberId = normalizeString(body.memberId);
      if (!memberId) {
        response.status(400).json({ error: 'memberId is required.' });
        return;
      }
      const binding = await storage.upsertSupplementBoxBinding({
        userId: request.auth.userId,
        memberId,
        binding: body,
      });
      response.json(binding);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/device-bindings', requireAuth, async (request, response, next) => {
    try {
      const memberId = normalizeString(request.query.memberId);
      if (!memberId) {
        response.status(400).json({ error: 'memberId is required.' });
        return;
      }
      response.json({
        bindings: await storage.listDeviceBindings({
          userId: request.auth.userId,
          memberId,
        }),
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/device-bindings', requireAuth, async (request, response, next) => {
    try {
      const body = normalizeObject(request.body);
      const memberId = normalizeString(body.memberId);
      if (!memberId) {
        response.status(400).json({ error: 'memberId is required.' });
        return;
      }
      const binding = await storage.upsertDeviceBinding({
        userId: request.auth.userId,
        memberId,
        binding: body,
      });
      response.json(binding);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/health-data', requireAuth, async (request, response, next) => {
    try {
      const body = normalizeObject(request.body);
      const record = await storage.saveHealthLog({
        userId: request.auth.userId,
        payload: body,
      });
      response.status(201).json({
        ok: true,
        recordId: record.id,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/health/snapshots', requireAuth, async (request, response, next) => {
    try {
      const body = normalizeObject(request.body);
      const memberId = normalizeString(body.memberId);
      if (!memberId) {
        response.status(400).json({ error: 'memberId is required.' });
        return;
      }
      const result = await storage.replaceHealthSnapshots({
        userId: request.auth.userId,
        memberId,
        snapshots: Array.isArray(body.snapshots) ? body.snapshots : [],
      });
      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/report/analyze', requireAuth, async (request, response, next) => {
    try {
      const body = normalizeObject(request.body);
      const result = buildReportAnalysis({
        imageUrl: body.imageUrl,
        reportType: body.reportType,
        ocrText: body.ocrText,
      });
      await storage.saveAnalysisRecord({
        type: 'report',
        userId: request.auth.userId,
        payload: result,
      });
      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/supplement/analyze', requireAuth, async (request, response, next) => {
    try {
      const body = normalizeObject(request.body);
      const result = buildSupplementAnalysis({
        imageUrl: body.imageUrl,
        ocrText: body.ocrText,
      });
      await storage.saveAnalysisRecord({
        type: 'supplement',
        userId: request.auth.userId,
        payload: result,
      });
      response.json(result);
    } catch (error) {
      next(error);
    }
  });
  app.post('/api/plan/recompute', requireAuth, async (request, response, next) => {
    try {
      const body = normalizeObject(request.body);
      const memberId = normalizeString(body.memberId);
      if (!memberId) {
        response.status(400).json({ error: 'memberId is required.' });
        return;
      }

      const latestPlan = await storage.getLatestPlan({
        userId: request.auth.userId,
        memberId,
      });
      const planPayload = {
        ...buildPlanPayload({
          memberId,
          latestVersion: normalizeNumber(latestPlan?.planVersion) ?? 0,
          source: storage.kind,
          payload: body,
          knowledgeVersion: CLOUD_KNOWLEDGE_VERSION,
          createId,
          sha256,
        }),
        userId: request.auth.userId,
      };
      const saved = await storage.savePlan({
        id: planPayload.id,
        userId: request.auth.userId,
        memberId,
        source: storage.kind,
        calorieTarget: planPayload.calorieTarget,
        slotAmounts: planPayload.slotAmounts,
        summary: planPayload.summary,
        generatedAt: planPayload.generatedAt,
        planPayload,
      });
      response.json(saved);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/plan/latest', requireAuth, async (request, response, next) => {
    try {
      const memberId = normalizeString(request.query.memberId);
      if (!memberId) {
        response.status(400).json({ error: 'memberId is required.' });
        return;
      }

      const plan = await storage.getLatestPlan({
        userId: request.auth.userId,
        memberId,
      });
      if (!plan) {
        response.status(404).json({ error: 'Plan not found.' });
        return;
      }
      response.json(plan);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/doctor/explain', requireAuth, async (request, response, next) => {
    try {
      const body = normalizeObject(request.body);
      let result;
      try {
        result = await callOpenAiDoctor(body);
      } catch (_) {
        result = buildDoctorFallback(body);
      }
      await storage.saveAnalysisRecord({
        type: 'doctor',
        userId: request.auth.userId,
        payload: {
          ...body,
          result,
        },
      });
      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.get('/healthz', (request, response) => {
    response.json({
      ok: true,
      storage: storage.kind,
      serverTime: new Date().toISOString(),
    });
  });

  app.use('/api', (request, response) => {
    response.status(404).json({ error: 'Not found.' });
  });

  app.use((error, request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }
    response.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error.',
    });
  });
}

async function getBootstrap() {
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      const storage = await createStorage();
      registerRoutes(storage);
      return {
        app,
        storage,
        startServer() {
          if (activeServer) {
            return Promise.resolve(activeServer);
          }
          return new Promise((resolve) => {
            activeServer = app.listen(PORT, () => {
              console.log(`AI Health API running on port ${PORT} (${storage.kind})`);
              resolve(activeServer);
            });
          });
        },
      };
    })();
  }
  return bootstrapPromise;
}

if (require.main === module) {
  getBootstrap()
    .then(({ startServer }) => startServer())
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = {
  app,
  buildReportAnalysis,
  buildSupplementAnalysis,
  createStorage,
  getBootstrap,
};
