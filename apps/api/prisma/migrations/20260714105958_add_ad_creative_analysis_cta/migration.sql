/*
  Warnings:

  - Added the required column `cta` to the `ad_creative_analyses` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "ad_creative_analyses" ADD COLUMN     "cta" TEXT NOT NULL;
