const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const express = require('express');
const mysql = require('mysql2/promise');

const app = express();
const PORT = Number(process.env.PORT || 8080);
const DATA_DIR = path.join(__dirname, 'data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');

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

function parseJsonField(rawValue, fallback = null) {
  if (rawValue == null) {
    return fallback;
  }
  if (typeof rawValue === 'object') {
    return rawValue;
  }
  try {
    return JSON.parse(rawValue);
  } catch (_) {
    return fallback;
  }
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
      'Unified backend APIs for auth, health snapshots, plans, and doctor explain.',
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
        payload: plan,
        createdAt: new Date().toISOString(),
      });
      writeLocalStore(store);
      return plan;
    },
    async getLatestPlan({ userId, memberId }) {
      const store = readLocalStore();
      const plans = store.plans
        .filter((plan) => plan.userId === userId)
        .filter((plan) => !memberId || plan.memberId === memberId)
        .sort((left, right) => (left.generatedAt < right.generatedAt ? 1 : -1));
      return plans[0] || null;
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
      if (!store.currentMemberIds[userId]) {
        store.currentMemberIds[userId] = memberId;
      }
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

function createMySqlStorage(pool) {
  async function getCurrentMemberId(userId) {
    const [rows] = await pool.execute(
      'SELECT current_member_id AS currentMemberId FROM users WHERE id = ? LIMIT 1',
      [userId],
    );
    return rows[0]?.currentMemberId || null;
  }

  async function loadMembers(userId) {
    const [rows] = await pool.execute(
      `SELECT id, name, avatar, relation, birth_date AS birthDate, gender, height, weight,
              blood_type AS bloodType, allergies_json AS allergies,
              chronic_diseases_json AS chronicDiseases, medications_json AS medications,
              is_managed AS isManaged, manager_id AS managerId, extra,
              created_at AS createdAt, updated_at AS updatedAt
         FROM members
        WHERE user_id = ?
        ORDER BY created_at ASC`,
      [userId],
    );
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      avatar: row.avatar,
      relation: row.relation,
      birthDate: normalizeDateTime(row.birthDate, null),
      gender: row.gender,
      height: normalizeNumber(row.height),
      weight: normalizeNumber(row.weight),
      bloodType: row.bloodType,
      allergies: normalizeStringList(parseJsonField(row.allergies, [])),
      chronicDiseases: normalizeStringList(parseJsonField(row.chronicDiseases, [])),
      medications: normalizeStringList(parseJsonField(row.medications, [])),
      isManaged: normalizeBoolean(row.isManaged),
      managerId: row.managerId,
      extra: row.extra,
      createdAt: normalizeDateTime(row.createdAt, new Date().toISOString()),
      updatedAt: normalizeDateTime(row.updatedAt, new Date().toISOString()),
    }));
  }

  async function loadMember(userId, memberId) {
    const members = await loadMembers(userId);
    return members.find((item) => item.id === memberId) || null;
  }

  async function loadSupplementBinding(userId, memberId, boxSlot) {
    const [rows] = await pool.execute(
      `SELECT id, member_id AS memberId, box_slot AS boxSlot, supplement_name AS supplementName,
              gram_per_unit AS gramPerUnit, image_url AS imageUrl,
              recognized_text AS recognizedText, confidence, nutrients_json AS nutrients,
              updated_at AS updatedAt
         FROM supplement_box_bindings
        WHERE user_id = ? AND member_id = ? AND box_slot = ?
        LIMIT 1`,
      [userId, memberId, boxSlot],
    );
    const row = rows[0];
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      memberId: row.memberId,
      boxSlot: row.boxSlot,
      supplementName: row.supplementName,
      gramPerUnit: normalizeNumber(row.gramPerUnit) ?? 0,
      imageUrl: row.imageUrl || '',
      recognizedText: row.recognizedText || '',
      confidence: normalizeNumber(row.confidence) ?? 0,
      nutrients: normalizeNutrientList(parseJsonField(row.nutrients, [])),
      updatedAt: normalizeDateTime(row.updatedAt, new Date().toISOString()),
    };
  }

  return {
    kind: 'mysql',
    async getUserByEmail(email) {
      const [rows] = await pool.execute(
        'SELECT id, email, display_name AS displayName, password_hash AS passwordHash, created_at AS createdAt, updated_at AS updatedAt FROM users WHERE email = ? LIMIT 1',
        [email],
      );
      return rows[0] || null;
    },
    async createUser({ email, displayName, password }) {
      const existing = await this.getUserByEmail(email);
      if (existing) {
        return null;
      }
      const id = createId('user');
      await pool.execute(
        'INSERT INTO users (id, email, display_name, password_hash) VALUES (?, ?, ?, ?)',
        [id, email, displayName, sha256(password)],
      );
      return this.getUserByEmail(email);
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
        'INSERT INTO auth_sessions (token, user_id, email, display_name, mode, is_demo, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
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
        'SELECT token, user_id AS userId, email, display_name AS displayName, mode, is_demo AS isDemo, created_at AS createdAt FROM auth_sessions WHERE token = ? LIMIT 1',
        [token],
      );
      if (!rows[0]) {
        return null;
      }
      return {
        ...rows[0],
        isDemo: normalizeBoolean(rows[0].isDemo),
        createdAt: normalizeDateTime(rows[0].createdAt, new Date().toISOString()),
      };
    },
    async deleteSession(token) {
      await pool.execute('DELETE FROM auth_sessions WHERE token = ?', [token]);
    },
    async saveHealthLog({ userId, payload }) {
      const [result] = await pool.execute(
        'INSERT INTO health_data_log (user_id, payload) VALUES (?, ?)',
        [userId, JSON.stringify(payload)],
      );
      return {
        id: result.insertId,
        userId,
        payload,
      };
    },
    async replaceHealthSnapshots({ userId, memberId, snapshots }) {
      await pool.execute(
        'DELETE FROM health_snapshots WHERE user_id = ? AND member_id = ?',
        [userId, memberId],
      );

      for (const snapshot of snapshots) {
        await pool.execute(
          `INSERT INTO health_snapshots
            (id, user_id, member_id, provider, metric_type, priority, source_id, normalized_data, raw_payload, collected_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            snapshot.id || createId('snapshot'),
            userId,
            memberId,
            snapshot.provider,
            snapshot.metricType,
            snapshot.priority,
            snapshot.sourceId || null,
            JSON.stringify(snapshot.normalizedData || {}),
            JSON.stringify(snapshot.rawPayload || {}),
            toMySqlDateTime(snapshot.collectedAt || new Date()),
          ],
        );
      }

      await pool.execute(
        'INSERT INTO sync_events (user_id, event_type, source_id, payload) VALUES (?, ?, ?, ?)',
        [userId, 'health-snapshots', memberId, JSON.stringify({ count: snapshots.length })],
      );

      return {
        memberId,
        count: snapshots.length,
      };
    },
    async savePlan(plan) {
      await pool.execute(
        'DELETE FROM generated_plans WHERE user_id = ? AND member_id = ?',
        [plan.userId, plan.memberId],
      );
      await pool.execute(
        `INSERT INTO generated_plans
          (id, user_id, member_id, source, calorie_target, slot_amounts, plan_payload, summary, generated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          plan.id,
          plan.userId,
          plan.memberId,
          plan.source,
          plan.calorieTarget,
          JSON.stringify(plan.slotAmounts),
          JSON.stringify(plan),
          plan.summary,
          toMySqlDateTime(plan.generatedAt),
        ],
      );
      await pool.execute(
        'INSERT INTO sync_events (user_id, event_type, source_id, payload) VALUES (?, ?, ?, ?)',
        [plan.userId, 'plan-recompute', plan.memberId, JSON.stringify(plan)],
      );
      return plan;
    },
    async getLatestPlan({ userId, memberId }) {
      const [rows] = await pool.execute(
        `SELECT id, user_id AS userId, member_id AS memberId, source,
                calorie_target AS calorieTarget, slot_amounts AS slotAmounts,
                plan_payload AS planPayload, summary, generated_at AS generatedAt
           FROM generated_plans
          WHERE user_id = ? AND (? = '' OR member_id = ?)
          ORDER BY generated_at DESC
          LIMIT 1`,
        [userId, memberId || '', memberId || ''],
      );
      if (!rows[0]) {
        return null;
      }
      return {
        ...rows[0],
        slotAmounts: parseJsonField(rows[0].slotAmounts, {}),
        planPayload: parseJsonField(rows[0].planPayload, null),
        generatedAt: normalizeDateTime(rows[0].generatedAt, new Date().toISOString()),
      };
    },
    async saveAnalysisRecord({ type, userId, payload }) {
      const id = createId(type);
      await pool.execute(
        'INSERT INTO analysis_records (id, user_id, record_type, payload) VALUES (?, ?, ?, ?)',
        [id, userId, type, JSON.stringify(payload)],
      );
      return {
        id,
        userId,
        payload,
        type,
      };
    },
    async getMembers({ userId }) {
      return {
        members: await loadMembers(userId),
        currentMemberId: await getCurrentMemberId(userId),
      };
    },
    async createMember({ userId, member }) {
      const normalized = normalizeMemberRecord(member);
      await pool.execute(
        `INSERT INTO members
          (id, user_id, name, avatar, relation, birth_date, gender, height, weight, blood_type,
           allergies_json, chronic_diseases_json, medications_json, is_managed, manager_id, extra,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      let currentMemberId = await getCurrentMemberId(userId);
      if (!currentMemberId) {
        currentMemberId = normalized.id;
        await pool.execute('UPDATE users SET current_member_id = ? WHERE id = ?', [
          currentMemberId,
          userId,
        ]);
      }
      return {
        member: normalized,
        currentMemberId,
      };
    },
    async updateMember({ userId, memberId, member }) {
      const existing = await loadMember(userId, memberId);
      if (!existing) {
        return null;
      }
      const normalized = normalizeMemberRecord(member, {
        idFallback: memberId,
        createdAtFallback: existing.createdAt,
      });
      await pool.execute(
        `UPDATE members
            SET name = ?, avatar = ?, relation = ?, birth_date = ?, gender = ?, height = ?, weight = ?,
                blood_type = ?, allergies_json = ?, chronic_diseases_json = ?, medications_json = ?,
                is_managed = ?, manager_id = ?, extra = ?, updated_at = ?
          WHERE user_id = ? AND id = ?`,
        [
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
          toMySqlDateTime(normalized.updatedAt),
          userId,
          memberId,
        ],
      );
      return loadMember(userId, memberId);
    },
    async deleteMember({ userId, memberId }) {
      const existing = await loadMember(userId, memberId);
      if (!existing) {
        return null;
      }
      await pool.execute('DELETE FROM supplement_box_bindings WHERE user_id = ? AND member_id = ?', [
        userId,
        memberId,
      ]);
      await pool.execute(
        'DELETE FROM device_bindings WHERE user_id = ? AND COALESCE(member_id, user_id) = ?',
        [userId, memberId],
      );
      await pool.execute('DELETE FROM members WHERE user_id = ? AND id = ?', [userId, memberId]);
      const currentMemberId = await getCurrentMemberId(userId);
      if (currentMemberId === memberId) {
        const remaining = await loadMembers(userId);
        await pool.execute('UPDATE users SET current_member_id = ? WHERE id = ?', [
          remaining[0]?.id || null,
          userId,
        ]);
      }
      return {
        currentMemberId: await getCurrentMemberId(userId),
      };
    },
    async setCurrentMember({ userId, memberId }) {
      const existing = await loadMember(userId, memberId);
      if (!existing) {
        return null;
      }
      await pool.execute('UPDATE users SET current_member_id = ? WHERE id = ?', [memberId, userId]);
      return memberId;
    },
    async listSupplementBoxBindings({ userId, memberId }) {
      const [rows] = await pool.execute(
        `SELECT id, member_id AS memberId, box_slot AS boxSlot, supplement_name AS supplementName,
                gram_per_unit AS gramPerUnit, image_url AS imageUrl,
                recognized_text AS recognizedText, confidence, nutrients_json AS nutrients,
                updated_at AS updatedAt
           FROM supplement_box_bindings
          WHERE user_id = ? AND member_id = ?
          ORDER BY box_slot ASC`,
        [userId, memberId],
      );
      return rows.map((row) => ({
        id: row.id,
        memberId: row.memberId,
        boxSlot: row.boxSlot,
        supplementName: row.supplementName,
        gramPerUnit: normalizeNumber(row.gramPerUnit) ?? 0,
        imageUrl: row.imageUrl || '',
        recognizedText: row.recognizedText || '',
        confidence: normalizeNumber(row.confidence) ?? 0,
        nutrients: normalizeNutrientList(parseJsonField(row.nutrients, [])),
        updatedAt: normalizeDateTime(row.updatedAt, new Date().toISOString()),
      }));
    },
    async upsertSupplementBoxBinding({ userId, memberId, binding }) {
      const existing = await loadSupplementBinding(
        userId,
        memberId,
        normalizeString(binding.boxSlot, 'A').toUpperCase(),
      );
      const normalized = normalizeSupplementBindingRecord(binding, memberId, {
        idFallback: existing?.id,
      });
      await pool.execute(
        `INSERT INTO supplement_box_bindings
          (id, user_id, member_id, box_slot, supplement_name, gram_per_unit, image_url,
           recognized_text, confidence, nutrients_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           supplement_name = VALUES(supplement_name),
           gram_per_unit = VALUES(gram_per_unit),
           image_url = VALUES(image_url),
           recognized_text = VALUES(recognized_text),
           confidence = VALUES(confidence),
           nutrients_json = VALUES(nutrients_json),
           updated_at = VALUES(updated_at)`,
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
      return loadSupplementBinding(userId, memberId, normalized.boxSlot);
    },
    async listDeviceBindings({ userId, memberId }) {
      const [rows] = await pool.execute(
        `SELECT id, COALESCE(member_id, user_id) AS memberId, device_name AS deviceName,
                device_type AS deviceType, mac_address AS macAddress,
                is_connected AS isConnected, last_sync AS lastSync, last_data AS lastData
           FROM device_bindings
          WHERE user_id = ? AND COALESCE(member_id, user_id) = ?
          ORDER BY last_sync ASC`,
        [userId, memberId],
      );
      return rows.map((row) => ({
        id: row.id,
        memberId: row.memberId,
        deviceName: row.deviceName,
        deviceType: row.deviceType,
        macAddress: row.macAddress || '',
        isConnected: normalizeBoolean(row.isConnected),
        lastSync: normalizeDateTime(row.lastSync, new Date().toISOString()),
        lastData: normalizeObject(parseJsonField(row.lastData, {})),
      }));
    },
    async upsertDeviceBinding({ userId, memberId, binding }) {
      const normalized = normalizeDeviceBindingRecord(binding, memberId);
      await pool.execute(
        `INSERT INTO device_bindings
          (id, user_id, member_id, device_name, device_type, mac_address, is_connected, last_sync, last_data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           user_id = VALUES(user_id),
           member_id = VALUES(member_id),
           device_name = VALUES(device_name),
           device_type = VALUES(device_type),
           mac_address = VALUES(mac_address),
           is_connected = VALUES(is_connected),
           last_sync = VALUES(last_sync),
           last_data = VALUES(last_data)`,
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
      const bindings = await this.listDeviceBindings({ userId, memberId });
      return bindings.find((item) => item.id === normalized.id) || null;
    },
  };
}

function readAuthToken(req) {
  const raw = req.headers.authorization || '';
  if (!raw.startsWith('Bearer ')) {
    return null;
  }
  return raw.slice('Bearer '.length).trim();
}

async function bootstrap() {
  const storage = await createStorage();

  async function requireSession(req, res, next) {
    const token = readAuthToken(req);
    if (!token) {
      res.status(401).json({ error: 'Missing bearer token.' });
      return;
    }

    const session = await storage.getSession(token);
    if (!session) {
      res.status(401).json({ error: 'Session not found.' });
      return;
    }

    req.session = session;
    next();
  }

  app.get('/api/version', (req, res) => {
    const policy = getVersionPolicy();
    res.json({
      version: policy.latestVersion,
      message: 'AI Health API',
      storage: storage.kind,
    });
  });

  app.get('/api/version/latest', (req, res) => {
    res.json(getVersionPolicy());
  });

  app.post('/api/auth/register', async (req, res) => {
    const { email, password, displayName } = req.body || {};
    if (!email || !password || !displayName) {
      res.status(400).json({ error: 'email, password, and displayName are required.' });
      return;
    }

    const user = await storage.createUser({ email, password, displayName });
    if (!user) {
      res.status(409).json({ error: 'Email already exists.' });
      return;
    }

    const session = await storage.createSession(user);
    res.json({ session });
  });

  app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body || {};
    const user = await storage.getUserByCredentials(email, password);
    if (!user) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    const session = await storage.createSession(user);
    res.json({ session });
  });

  app.get('/api/auth/session', requireSession, async (req, res) => {
    res.json({ session: req.session });
  });

  app.post('/api/auth/logout', requireSession, async (req, res) => {
    await storage.deleteSession(req.session.token);
    res.json({ success: true });
  });

  app.get('/api/members', requireSession, async (req, res) => {
    const result = await storage.getMembers({ userId: req.session.userId });
    res.json(result);
  });

  app.post('/api/members', requireSession, async (req, res) => {
    const name = normalizeString(req.body?.name);
    if (!name) {
      res.status(400).json({ error: 'name is required.' });
      return;
    }
    const result = await storage.createMember({
      userId: req.session.userId,
      member: req.body || {},
    });
    res.json(result);
  });

  app.put('/api/members/:id', requireSession, async (req, res) => {
    const memberId = normalizeString(req.params.id);
    if (!memberId) {
      res.status(400).json({ error: 'member id is required.' });
      return;
    }
    const updated = await storage.updateMember({
      userId: req.session.userId,
      memberId,
      member: req.body || {},
    });
    if (!updated) {
      res.status(404).json({ error: 'Member not found.' });
      return;
    }
    res.json(updated);
  });

  app.delete('/api/members/:id', requireSession, async (req, res) => {
    const memberId = normalizeString(req.params.id);
    const result = await storage.deleteMember({
      userId: req.session.userId,
      memberId,
    });
    if (!result) {
      res.status(404).json({ error: 'Member not found.' });
      return;
    }
    res.json({ success: true, currentMemberId: result.currentMemberId || null });
  });

  app.post('/api/members/:id/select', requireSession, async (req, res) => {
    const memberId = normalizeString(req.params.id);
    const selected = await storage.setCurrentMember({
      userId: req.session.userId,
      memberId,
    });
    if (!selected) {
      res.status(404).json({ error: 'Member not found.' });
      return;
    }
    res.json({ success: true, currentMemberId: selected });
  });

  app.get('/api/supplement-box-bindings', requireSession, async (req, res) => {
    const memberId = normalizeString(req.query.memberId);
    if (!memberId) {
      res.status(400).json({ error: 'memberId is required.' });
      return;
    }
    const bindings = await storage.listSupplementBoxBindings({
      userId: req.session.userId,
      memberId,
    });
    res.json({ bindings });
  });

  app.post('/api/supplement-box-bindings', requireSession, async (req, res) => {
    const memberId = normalizeString(req.body?.memberId);
    const boxSlot = normalizeString(req.body?.boxSlot).toUpperCase();
    if (!memberId || !boxSlot) {
      res.status(400).json({ error: 'memberId and boxSlot are required.' });
      return;
    }
    const binding = await storage.upsertSupplementBoxBinding({
      userId: req.session.userId,
      memberId,
      binding: req.body || {},
    });
    res.json(binding);
  });

  app.get('/api/device-bindings', requireSession, async (req, res) => {
    const memberId = normalizeString(req.query.memberId);
    if (!memberId) {
      res.status(400).json({ error: 'memberId is required.' });
      return;
    }
    const bindings = await storage.listDeviceBindings({
      userId: req.session.userId,
      memberId,
    });
    res.json({ bindings });
  });

  app.post('/api/device-bindings', requireSession, async (req, res) => {
    const memberId = normalizeString(req.body?.memberId);
    const deviceId = normalizeString(req.body?.id);
    if (!memberId || !deviceId) {
      res.status(400).json({ error: 'memberId and id are required.' });
      return;
    }
    const binding = await storage.upsertDeviceBinding({
      userId: req.session.userId,
      memberId,
      binding: req.body || {},
    });
    res.json(binding);
  });

  app.post('/api/health-data', requireSession, async (req, res) => {
    const userId = req.body?.userId || req.body?.memberId || req.session.userId;
    const record = await storage.saveHealthLog({
      userId,
      payload: req.body || {},
    });
    res.json({
      success: true,
      storage: storage.kind,
      id: record.id,
    });
  });

  app.post('/api/health/snapshots', requireSession, async (req, res) => {
    const { memberId, snapshots } = req.body || {};
    if (!memberId || !Array.isArray(snapshots)) {
      res.status(400).json({ error: 'memberId and snapshots[] are required.' });
      return;
    }

    const result = await storage.replaceHealthSnapshots({
      userId: req.session.userId,
      memberId,
      snapshots,
    });
    res.json({
      success: true,
      storage: storage.kind,
      memberId,
      uploaded: result.count,
    });
  });

  app.post('/api/report/analyze', requireSession, async (req, res) => {
    const ocrText = String(req.body?.ocrText || '');
    const reportType = String(req.body?.reportType || 'hospital_body_composition');
    const imageUrl = String(req.body?.imageUrl || '');
    const payload = {
      reportType,
      imageUrl,
      weightKg: extractNumericValue(ocrText, [
        /体重[:：]?\s*(\d+(?:\.\d+)?)/i,
        /weight[:：]?\s*(\d+(?:\.\d+)?)/i,
      ]),
      bodyFatPercent: extractNumericValue(ocrText, [
        /体脂[:：]?\s*(\d+(?:\.\d+)?)/i,
        /body fat[:：]?\s*(\d+(?:\.\d+)?)/i,
      ]),
      bmi: extractNumericValue(ocrText, [/BMI[:：]?\s*(\d+(?:\.\d+)?)/i]),
      confidence: ocrText.trim() ? 0.74 : 0.42,
      recognizedText: ocrText.slice(0, 180),
    };
    await storage.saveAnalysisRecord({
      type: 'report',
      userId: req.session.userId,
      payload,
    });
    res.json(payload);
  });

  app.post('/api/supplement/analyze', requireSession, async (req, res) => {
    const ocrText = String(req.body?.ocrText || '');
    const imageUrl = String(req.body?.imageUrl || '');
    const gram = extractNumericValue(ocrText, [/(\d+(?:\.\d+)?)\s*g/i]);
    const payload = {
      imageUrl,
      supplementName: ocrText.includes('维C') ? '维生素C' : '待确认补剂',
      supplementType: 'supplement',
      gramPerServing: gram,
      confidence: ocrText.trim() ? 0.71 : 0.38,
      recognizedEvidence: ocrText.slice(0, 180),
      needsManualGram: gram == null,
      nutrients: [],
    };
    await storage.saveAnalysisRecord({
      type: 'supplement',
      userId: req.session.userId,
      payload,
    });
    res.json(payload);
  });

  app.post('/api/plan/recompute', requireSession, async (req, res) => {
    const { memberId, fusedHealthProfile, nutritionGaps } = req.body || {};
    if (!memberId) {
      res.status(400).json({ error: 'memberId is required.' });
      return;
    }

    const deficits = nutritionGaps?.deficits || {};
    const plan = {
      id: createId('plan'),
      userId: req.session.userId,
      memberId,
      source: storage.kind === 'mysql' ? 'mysql-rule-engine' : 'local-rule-engine',
      calorieTarget: Number((fusedHealthProfile?.weightKg || 60) * 28),
      slotAmounts: {
        A:
          typeof deficits.protein === 'number'
            ? Number((deficits.protein / 15).toFixed(1))
            : 0,
        C:
          typeof deficits.vitaminC === 'number'
            ? Number((deficits.vitaminC / 100).toFixed(1))
            : 0,
        E:
          typeof deficits.iron === 'number'
            ? Number((deficits.iron / 10).toFixed(1))
            : 0,
      },
      summary: 'Plan recomputed from fused profile and nutrition gaps.',
      generatedAt: new Date().toISOString(),
    };

    const savedPlan = await storage.savePlan(plan);
    res.json(savedPlan);
  });

  app.get('/api/plan/latest', requireSession, async (req, res) => {
    const memberId = String(req.query.memberId || '');
    const plan = await storage.getLatestPlan({
      userId: req.session.userId,
      memberId,
    });
    if (!plan) {
      res.status(404).json({ error: 'No plan found.' });
      return;
    }
    res.json(plan);
  });

  app.post('/api/doctor/explain', requireSession, async (req, res) => {
    try {
      const result = await callOpenAiDoctor(req.body || {});
      res.json(result);
    } catch (error) {
      res.status(200).json({
        ...buildDoctorFallback(req.body || {}),
        warnings: [`Doctor fallback activated: ${String(error.message || error)}`],
      });
    }
  });

  return {
    storage,
    startServer(port = PORT) {
      return app.listen(port, '0.0.0.0', () => {
        console.log(`AI Health API running on port ${port} (${storage.kind})`);
      });
    },
  };
}

let bootstrapPromise = null;

function getBootstrap() {
  if (!bootstrapPromise) {
    bootstrapPromise = bootstrap();
  }
  return bootstrapPromise;
}

if (require.main === module) {
  getBootstrap()
    .then(({ startServer }) => startServer(PORT))
    .catch((error) => {
      console.error('Failed to bootstrap server:', error);
      process.exit(1);
    });
}

module.exports = {
  app,
  getBootstrap,
};


