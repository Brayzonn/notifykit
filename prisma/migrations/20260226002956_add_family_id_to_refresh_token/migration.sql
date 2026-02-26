/*
  Warnings:

  - Added the required column `familyId` to the `refresh_tokens` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN "familyId" TEXT NOT NULL DEFAULT gen_random_uuid();
