function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function toIsoString(value, fallback = new Date().toISOString()) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function toNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

function ensureObjectArray(rawValue) {
  if (!Array.isArray(rawValue)) {
    return [];
  }
  return rawValue.filter(isPlainObject).map((item) => cloneJson(item));
}

function sortByDate(items, field, direction = 'asc') {
  const sorted = [...items];
  sorted.sort((left, right) => {
    const leftTime = Date.parse(left?.[field] || '') || 0;
    const rightTime = Date.parse(right?.[field] || '') || 0;
    if (leftTime === rightTime) {
      return 0;
    }
    return direction === 'desc' ? rightTime - leftTime : leftTime - rightTime;
  });
  return sorted;
}

function sortPlanHistory(items) {
  const sorted = [...items];
  sorted.sort((left, right) => {
    const leftVersion = Number(left?.planVersion || 0);
    const rightVersion = Number(right?.planVersion || 0);
    if (leftVersion !== rightVersion) {
      return rightVersion - leftVersion;
    }
    const leftTime = Date.parse(left?.generatedAt || '') || 0;
    const rightTime = Date.parse(right?.generatedAt || '') || 0;
    return rightTime - leftTime;
  });
  return sorted;
}

function normalizeMemberProfile(memberProfile, memberId) {
  if (!isPlainObject(memberProfile)) {
    return null;
  }
  return {
    ...cloneJson(memberProfile),
    id: String(memberProfile.id || memberId || ''),
  };
}

function upsertPlanHistory(history, latestPlan) {
  const unique = new Map();
  for (const item of ensureObjectArray(history)) {
    const id = String(item.id || '');
    if (!id) {
      continue;
    }
    unique.set(id, { ...item, id });
  }
  if (isPlainObject(latestPlan)) {
    const id = String(latestPlan.id || '');
    if (id) {
      unique.set(id, { ...cloneJson(latestPlan), id });
    }
  }
  return sortPlanHistory([...unique.values()]);
}

function normalizeCloudState(rawValue, { userId = '', memberId = '' } = {}) {
  const source = isPlainObject(rawValue) ? rawValue : {};
  const resolvedUserId = String(source.userId || userId || '');
  const resolvedMemberId = String(source.memberId || memberId || '');
  let latestPlan = isPlainObject(source.latestPlan) ? cloneJson(source.latestPlan) : null;
  let planHistory = upsertPlanHistory(source.planHistory, latestPlan);
  if (!latestPlan && planHistory.length > 0) {
    latestPlan = cloneJson(planHistory[0]);
  }

  const normalized = {
    userId: resolvedUserId,
    memberId: resolvedMemberId,
    memberProfile: normalizeMemberProfile(source.memberProfile, resolvedMemberId),
    dailyStatusHistory: sortByDate(ensureObjectArray(source.dailyStatusHistory), 'recordDate'),
    hospitalReports: sortByDate(ensureObjectArray(source.hospitalReports), 'reportDate'),
    bodyFatReports: sortByDate(ensureObjectArray(source.bodyFatReports), 'reportDate'),
    supplementBoxes: ensureObjectArray(source.supplementBoxes).sort((left, right) =>
      String(left.boxSlot || '').localeCompare(String(right.boxSlot || '')),
    ),
    deviceBindings: sortByDate(ensureObjectArray(source.deviceBindings), 'lastSync'),
    chatHistory: sortByDate(ensureObjectArray(source.chatHistory), 'createdAt'),
    planHistory,
    latestPlan,
    updatedAt: toIsoString(source.updatedAt),
  };

  if (normalized.latestPlan) {
    normalized.planHistory = upsertPlanHistory(normalized.planHistory, normalized.latestPlan);
  }

  return normalized;
}
function mergeCloudState(currentState, patch, meta) {
  const base = normalizeCloudState(currentState, meta);
  if (!isPlainObject(patch)) {
    return {
      ...base,
      updatedAt: new Date().toISOString(),
    };
  }

  const next = { ...base };

  if (Object.prototype.hasOwnProperty.call(patch, 'memberProfile')) {
    next.memberProfile = normalizeMemberProfile(
      patch.memberProfile,
      meta?.memberId || base.memberId,
    );
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'dailyStatusHistory')) {
    next.dailyStatusHistory = sortByDate(
      ensureObjectArray(patch.dailyStatusHistory),
      'recordDate',
    );
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'hospitalReports')) {
    next.hospitalReports = sortByDate(
      ensureObjectArray(patch.hospitalReports),
      'reportDate',
    );
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'bodyFatReports')) {
    next.bodyFatReports = sortByDate(
      ensureObjectArray(patch.bodyFatReports),
      'reportDate',
    );
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'supplementBoxes')) {
    next.supplementBoxes = ensureObjectArray(patch.supplementBoxes).sort((left, right) =>
      String(left.boxSlot || '').localeCompare(String(right.boxSlot || '')),
    );
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'deviceBindings')) {
    next.deviceBindings = sortByDate(
      ensureObjectArray(patch.deviceBindings),
      'lastSync',
    );
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'chatHistory')) {
    next.chatHistory = sortByDate(
      ensureObjectArray(patch.chatHistory),
      'createdAt',
    );
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'latestPlan')) {
    next.latestPlan = isPlainObject(patch.latestPlan) ? cloneJson(patch.latestPlan) : null;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'planHistory')) {
    next.planHistory = upsertPlanHistory(patch.planHistory, next.latestPlan);
  } else if (next.latestPlan) {
    next.planHistory = upsertPlanHistory(next.planHistory, next.latestPlan);
  }
  if (!next.latestPlan && next.planHistory.length > 0) {
    next.latestPlan = cloneJson(next.planHistory[0]);
  }

  next.updatedAt = new Date().toISOString();
  return next;
}

function buildPlanResponseFromRecord(planRecord) {
  const slotAmounts = parseJsonField(planRecord.slotAmounts, {});
  const planPayload = parseJsonField(planRecord.planPayload, null);
  if (isPlainObject(planPayload)) {
    return {
      ...cloneJson(planPayload),
      id: String(planPayload.id || planRecord.id || ''),
      memberId: String(planRecord.memberId || planPayload.memberId || ''),
      slotAmounts: isPlainObject(planPayload.slotAmounts)
        ? planPayload.slotAmounts
        : slotAmounts,
      source: String(planPayload.source || planRecord.source || ''),
      calorieTarget:
        toNumber(planPayload.calorieTarget) ?? toNumber(planRecord.calorieTarget) ?? 0,
      summary: String(planPayload.summary || planRecord.summary || ''),
      generatedAt: toIsoString(planPayload.generatedAt || planRecord.generatedAt),
    };
  }

  return {
    id: String(planRecord.id || ''),
    userId: String(planRecord.memberId || ''),
    memberId: String(planRecord.memberId || ''),
    calorieTarget: toNumber(planRecord.calorieTarget) ?? 0,
    supplementTarget: {},
    supplementSlotMap: {},
    planVersion: Number(planRecord.planVersion || 1),
    triggerType: 'cloud_sync',
    sourceId: String(planRecord.memberId || ''),
    inputHash: '',
    knowledgeVersion: 'legacy-plan',
    summary: String(planRecord.summary || ''),
    highlights: [],
    auditTrail: [],
    metrics: {},
    generatedAt: toIsoString(planRecord.generatedAt),
    slotAmounts,
    source: String(planRecord.source || ''),
  };
}

function appendPlanToCloudState(currentState, planRecord) {
  const base = normalizeCloudState(currentState, {
    userId: planRecord.userId,
    memberId: planRecord.memberId,
  });
  const latestPlan = buildPlanResponseFromRecord(planRecord);
  return mergeCloudState(
    base,
    {
      latestPlan,
      planHistory: upsertPlanHistory(base.planHistory, latestPlan),
    },
    {
      userId: planRecord.userId,
      memberId: planRecord.memberId,
    },
  );
}

function buildSlotAmounts(deficits) {
  return {
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
  };
}

function buildSupplementProjection(slotAmounts, supplementCatalog) {
  const supplementTarget = {};
  const supplementSlotMap = {};
  const occupied = new Map();
  const catalog = Array.isArray(supplementCatalog) ? supplementCatalog : [];

  for (const [slot, amountRaw] of Object.entries(slotAmounts || {})) {
    const amount = toNumber(amountRaw);
    if (amount == null || amount <= 0) {
      continue;
    }
    const binding = catalog.find(
      (item) => String(item?.slot || '').toUpperCase() === String(slot).toUpperCase(),
    );
    let key = String(binding?.supplementName || `Slot ${slot}`).trim() || `Slot ${slot}`;
    const duplicateIndex = occupied.has(key) ? occupied.get(key) + 1 : 0;
    occupied.set(key, duplicateIndex);
    if (duplicateIndex > 0) {
      key = `${key} (${slot})`;
    }
    supplementTarget[key] = amount;
    supplementSlotMap[key] = slot;
  }

  return { supplementTarget, supplementSlotMap };
}
function buildPlanMetrics(payload) {
  const fusedProfile = isPlainObject(payload.fusedHealthProfile)
    ? payload.fusedHealthProfile
    : {};
  const reportMetrics = isPlainObject(payload.reportMetrics) ? payload.reportMetrics : {};
  const latestDevice = isPlainObject(payload.latestDevice) ? payload.latestDevice : {};
  const latestDeviceData = isPlainObject(latestDevice.lastData) ? latestDevice.lastData : {};

  return {
    bodyFat:
      toNumber(reportMetrics.bodyFatPercent) ?? toNumber(fusedProfile.bodyFatPercent) ?? 0,
    waterRatio: toNumber(reportMetrics.waterRatio) ?? 0,
    bmi: toNumber(reportMetrics.bmi) ?? toNumber(fusedProfile.bmi) ?? 0,
    heartRate:
      toNumber(latestDeviceData.heartRate) ?? toNumber(fusedProfile.heartRate) ?? 0,
    humidity:
      toNumber(latestDeviceData.humidity) ?? toNumber(fusedProfile.deviceHumidity) ?? 0,
  };
}

function buildPlanPayload({
  memberId,
  latestVersion,
  source,
  payload,
  knowledgeVersion,
  createId,
  sha256,
}) {
  const fusedProfile = isPlainObject(payload.fusedHealthProfile)
    ? payload.fusedHealthProfile
    : {};
  const nutritionGaps = isPlainObject(payload.nutritionGaps) ? payload.nutritionGaps : {};
  const deficits = isPlainObject(nutritionGaps.deficits) ? nutritionGaps.deficits : {};
  const supplementCatalog = Array.isArray(payload.supplementCatalog)
    ? payload.supplementCatalog
    : [];
  const metrics = buildPlanMetrics(payload);
  const slotAmounts = buildSlotAmounts(deficits);
  const generatedAt = new Date().toISOString();
  const calorieTarget = Number((toNumber(fusedProfile.weightKg) || 60) * 28);
  const { supplementTarget, supplementSlotMap } = buildSupplementProjection(
    slotAmounts,
    supplementCatalog,
  );
  const triggerType = String(payload.triggerType || 'remote_sync');
  const sourceId = String(payload.sourceId || memberId);
  const planVersion = Math.max(1, Number(latestVersion || 0) + 1);
  const dominantDeficits = Object.keys(deficits).slice(0, 3);
  const highlights = [
    dominantDeficits.length > 0
      ? `优先缺口 ${dominantDeficits.join('、')}`
      : '当前以基础维持策略为主',
    Object.keys(supplementSlotMap).length > 0
      ? `已映射 ${Object.keys(supplementSlotMap).length} 个盒位动作`
      : '暂未识别到可下发的盒位动作',
    metrics.humidity > 0 ? `设备湿度 ${metrics.humidity.toFixed(1)}%` : '等待设备湿度回传',
  ];
  const summary = `Plan recomputed for member ${memberId} using backend cloud state and nutrition gaps.`;
  const auditTrail = [
    `Trigger ${triggerType} from ${sourceId}.`,
    `Backend recalculated calorie target ${calorieTarget.toFixed(0)} kcal and ${Object.keys(slotAmounts).length} slot amounts.`,
    `Knowledge version ${knowledgeVersion}.`,
  ];
  const inputHash = sha256(
    JSON.stringify({
      memberId,
      triggerType,
      sourceId,
      deficits,
      slotAmounts,
      supplementCatalog,
      metrics,
    }),
  );

  return {
    id: createId('plan'),
    userId: memberId,
    memberId,
    calorieTarget,
    supplementTarget,
    supplementSlotMap,
    planVersion,
    triggerType,
    sourceId,
    inputHash,
    knowledgeVersion,
    summary,
    highlights,
    auditTrail,
    metrics,
    generatedAt,
    slotAmounts,
    source,
  };
}

function findLocalCloudState(store, userId, memberId) {
  return (
    store.memberStates.find(
      (item) => item.userId === userId && item.memberId === memberId,
    ) || null
  );
}

function upsertLocalCloudState(store, state) {
  store.memberStates = store.memberStates.filter(
    (item) => !(item.userId === state.userId && item.memberId === state.memberId),
  );
  store.memberStates.push(normalizeCloudState(state, state));
}

module.exports = {
  buildPlanPayload,
  buildPlanResponseFromRecord,
  appendPlanToCloudState,
  findLocalCloudState,
  isPlainObject,
  mergeCloudState,
  normalizeCloudState,
  parseJsonField,
  toIsoString,
  upsertLocalCloudState,
};
