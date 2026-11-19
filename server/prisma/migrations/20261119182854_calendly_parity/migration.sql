-- AlterTable
ALTER TABLE "User" ADD COLUMN "limitDay" INTEGER;
ALTER TABLE "User" ADD COLUMN "limitMonth" INTEGER;
ALTER TABLE "User" ADD COLUMN "limitWeek" INTEGER;

-- CreateTable
CREATE TABLE "SingleUseLink" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "token" TEXT NOT NULL,
    "eventTypeId" INTEGER NOT NULL,
    "bookingId" INTEGER,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SingleUseLink_eventTypeId_fkey" FOREIGN KEY ("eventTypeId") REFERENCES "EventType" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SingleUseLink_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Booking" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "uid" TEXT NOT NULL,
    "companyId" INTEGER NOT NULL,
    "eventTypeId" INTEGER NOT NULL,
    "hostId" INTEGER NOT NULL,
    "startTime" DATETIME NOT NULL,
    "endTime" DATETIME NOT NULL,
    "inviteeName" TEXT NOT NULL,
    "inviteeEmail" TEXT NOT NULL,
    "inviteeTimezone" TEXT NOT NULL,
    "guestsJson" TEXT NOT NULL DEFAULT '[]',
    "answersJson" TEXT NOT NULL DEFAULT '{}',
    "notes" TEXT,
    "location" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CONFIRMED',
    "cancelReason" TEXT,
    "canceledBy" TEXT,
    "canceledAt" DATETIME,
    "rescheduleCount" INTEGER NOT NULL DEFAULT 0,
    "googleCalendarId" TEXT,
    "googleEventId" TEXT,
    "googleBufferIdsJson" TEXT NOT NULL DEFAULT '[]',
    "meetLink" TEXT,
    "remindersSentJson" TEXT NOT NULL DEFAULT '[]',
    "followUpSentAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Booking_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Booking_eventTypeId_fkey" FOREIGN KEY ("eventTypeId") REFERENCES "EventType" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Booking_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Booking" ("answersJson", "cancelReason", "canceledAt", "canceledBy", "companyId", "createdAt", "endTime", "eventTypeId", "googleCalendarId", "googleEventId", "hostId", "id", "inviteeEmail", "inviteeName", "inviteeTimezone", "location", "meetLink", "notes", "rescheduleCount", "startTime", "status", "uid") SELECT "answersJson", "cancelReason", "canceledAt", "canceledBy", "companyId", "createdAt", "endTime", "eventTypeId", "googleCalendarId", "googleEventId", "hostId", "id", "inviteeEmail", "inviteeName", "inviteeTimezone", "location", "meetLink", "notes", "rescheduleCount", "startTime", "status", "uid" FROM "Booking";
DROP TABLE "Booking";
ALTER TABLE "new_Booking" RENAME TO "Booking";
CREATE UNIQUE INDEX "Booking_uid_key" ON "Booking"("uid");
CREATE INDEX "Booking_hostId_startTime_idx" ON "Booking"("hostId", "startTime");
CREATE TABLE "new_EventType" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "companyId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "scheduleId" INTEGER,
    "kind" TEXT NOT NULL DEFAULT 'one_on_one',
    "seats" INTEGER,
    "oneOffSlotsJson" TEXT NOT NULL DEFAULT '[]',
    "isSecret" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT '#2563eb',
    "durationMinutes" INTEGER NOT NULL DEFAULT 30,
    "locationType" TEXT NOT NULL DEFAULT 'google_meet',
    "locationValue" TEXT,
    "bufferBefore" INTEGER NOT NULL DEFAULT 0,
    "bufferAfter" INTEGER NOT NULL DEFAULT 0,
    "minNoticeMinutes" INTEGER NOT NULL DEFAULT 240,
    "maxDaysAhead" INTEGER NOT NULL DEFAULT 60,
    "slotInterval" INTEGER,
    "dailyLimit" INTEGER,
    "weeklyLimit" INTEGER,
    "monthlyLimit" INTEGER,
    "lockTimezone" BOOLEAN NOT NULL DEFAULT false,
    "allowGuests" BOOLEAN NOT NULL DEFAULT true,
    "questionsJson" TEXT NOT NULL DEFAULT '[]',
    "redirectUrl" TEXT,
    "confirmationLinksJson" TEXT NOT NULL DEFAULT '[]',
    "remindersJson" TEXT NOT NULL DEFAULT '[]',
    "followUpMinutes" INTEGER,
    "followUpMessage" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EventType_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "EventType_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "EventType_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_EventType" ("bufferAfter", "bufferBefore", "color", "companyId", "createdAt", "dailyLimit", "description", "durationMinutes", "id", "isActive", "locationType", "locationValue", "maxDaysAhead", "minNoticeMinutes", "questionsJson", "scheduleId", "slotInterval", "slug", "title", "userId") SELECT "bufferAfter", "bufferBefore", "color", "companyId", "createdAt", "dailyLimit", "description", "durationMinutes", "id", "isActive", "locationType", "locationValue", "maxDaysAhead", "minNoticeMinutes", "questionsJson", "scheduleId", "slotInterval", "slug", "title", "userId" FROM "EventType";
DROP TABLE "EventType";
ALTER TABLE "new_EventType" RENAME TO "EventType";
CREATE UNIQUE INDEX "EventType_userId_slug_key" ON "EventType"("userId", "slug");
CREATE TABLE "new_GoogleConnection" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "userId" INTEGER NOT NULL,
    "googleEmail" TEXT NOT NULL,
    "refreshTokenEnc" TEXT NOT NULL,
    "accessTokenEnc" TEXT,
    "expiryDate" DATETIME,
    "conflictCalendarIdsJson" TEXT NOT NULL DEFAULT '["primary"]',
    "targetCalendarId" TEXT NOT NULL DEFAULT 'primary',
    "includeBuffers" BOOLEAN NOT NULL DEFAULT false,
    "syncFromGoogle" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GoogleConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_GoogleConnection" ("accessTokenEnc", "conflictCalendarIdsJson", "createdAt", "expiryDate", "googleEmail", "id", "lastError", "refreshTokenEnc", "targetCalendarId", "updatedAt", "userId") SELECT "accessTokenEnc", "conflictCalendarIdsJson", "createdAt", "expiryDate", "googleEmail", "id", "lastError", "refreshTokenEnc", "targetCalendarId", "updatedAt", "userId" FROM "GoogleConnection";
DROP TABLE "GoogleConnection";
ALTER TABLE "new_GoogleConnection" RENAME TO "GoogleConnection";
CREATE UNIQUE INDEX "GoogleConnection_userId_key" ON "GoogleConnection"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "SingleUseLink_token_key" ON "SingleUseLink"("token");

-- CreateIndex
CREATE UNIQUE INDEX "SingleUseLink_bookingId_key" ON "SingleUseLink"("bookingId");
