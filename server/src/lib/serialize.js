// Los campos *Json son strings (Prisma 5 + SQLite no tiene columnas Json).
// Toda lectura pasa por acá para no repartir JSON.parse por las rutas.
function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (e) {
    return fallback;
  }
}

const DEFAULT_WEEKLY = {
  0: [],
  1: [['09:00', '17:00']],
  2: [['09:00', '17:00']],
  3: [['09:00', '17:00']],
  4: [['09:00', '17:00']],
  5: [['09:00', '17:00']],
  6: [],
};

function serializeSchedule(s) {
  if (!s) return null;
  return {
    id: s.id,
    name: s.name,
    timezone: s.timezone,
    isDefault: s.isDefault,
    weekly: parseJson(s.weeklyJson, DEFAULT_WEEKLY),
    overrides: parseJson(s.overridesJson, []),
  };
}

function serializeEventType(e) {
  return {
    id: e.id,
    userId: e.userId,
    scheduleId: e.scheduleId,
    title: e.title,
    slug: e.slug,
    description: e.description,
    color: e.color,
    durationMinutes: e.durationMinutes,
    locationType: e.locationType,
    locationValue: e.locationValue,
    bufferBefore: e.bufferBefore,
    bufferAfter: e.bufferAfter,
    minNoticeMinutes: e.minNoticeMinutes,
    maxDaysAhead: e.maxDaysAhead,
    slotInterval: e.slotInterval,
    dailyLimit: e.dailyLimit,
    weeklyLimit: e.weeklyLimit,
    monthlyLimit: e.monthlyLimit,
    kind: e.kind,
    seats: e.seats,
    oneOffSlots: parseJson(e.oneOffSlotsJson, []),
    isSecret: e.isSecret,
    lockTimezone: e.lockTimezone,
    allowGuests: e.allowGuests,
    questions: parseJson(e.questionsJson, []).map(normalizeQuestion),
    redirectUrl: e.redirectUrl,
    confirmationLinks: parseJson(e.confirmationLinksJson, []),
    reminders: parseJson(e.remindersJson, []),
    followUpMinutes: e.followUpMinutes,
    followUpMessage: e.followUpMessage,
    isActive: e.isActive,
  };
}

// Preguntas guardadas antes de que existieran enabled/options las completa con
// los defaults, así ningún consumidor tiene que chequear undefined.
function normalizeQuestion(q) {
  return {
    id: q.id,
    label: q.label,
    type: q.type || 'text',
    required: Boolean(q.required),
    enabled: q.enabled !== false,
    options: Array.isArray(q.options) ? q.options : [],
    allowOther: Boolean(q.allowOther),
  };
}

function enabledQuestions(e) {
  return parseJson(e.questionsJson, []).map(normalizeQuestion).filter((q) => q.enabled);
}

// Versión para la página pública: sin reglas internas ni ids de usuario.
// `timezone` sólo viaja si el host fijó la zona (lockTimezone).
function serializePublicEventType(e, { timezone } = {}) {
  return {
    id: e.id,
    title: e.title,
    slug: e.slug,
    description: e.description,
    color: e.color,
    durationMinutes: e.durationMinutes,
    locationType: e.locationType,
    kind: e.kind,
    seats: e.kind === 'group' ? e.seats : null,
    allowGuests: e.allowGuests,
    lockedTimezone: e.lockTimezone ? timezone || null : null,
    // La dirección física / link custom se muestra recién en la confirmación.
    questions: enabledQuestions(e),
  };
}

function serializeBooking(b) {
  return {
    id: b.id,
    uid: b.uid,
    startTime: b.startTime,
    endTime: b.endTime,
    inviteeName: b.inviteeName,
    inviteeEmail: b.inviteeEmail,
    inviteeTimezone: b.inviteeTimezone,
    guests: parseJson(b.guestsJson, []),
    answers: parseJson(b.answersJson, {}),
    notes: b.notes,
    location: b.location,
    meetLink: b.meetLink,
    status: b.status,
    cancelReason: b.cancelReason,
    canceledBy: b.canceledBy,
    canceledAt: b.canceledAt,
    rescheduleCount: b.rescheduleCount,
    createdAt: b.createdAt,
    eventType: b.eventType
      ? {
          id: b.eventType.id,
          title: b.eventType.title,
          slug: b.eventType.slug,
          color: b.eventType.color,
          durationMinutes: b.eventType.durationMinutes,
          locationType: b.eventType.locationType,
          kind: b.eventType.kind,
          isActive: b.eventType.isActive,
          questions: parseJson(b.eventType.questionsJson, []).map(normalizeQuestion),
          confirmationLinks: parseJson(b.eventType.confirmationLinksJson, []),
        }
      : undefined,
    host: b.host ? { name: b.host.name, email: b.host.email, username: b.host.username, avatarUrl: b.host.avatarUrl } : undefined,
  };
}

module.exports = {
  parseJson,
  DEFAULT_WEEKLY,
  serializeSchedule,
  serializeEventType,
  serializePublicEventType,
  serializeBooking,
  normalizeQuestion,
  enabledQuestions,
};
