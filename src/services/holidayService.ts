import mongoose from "mongoose";
import { Holiday, IHoliday } from "../models/Holiday";

export const DEFAULT_GOVERNMENT_HOLIDAYS = [
  { name: "Republic Day", month: 1, day: 26, isGovernmentHoliday: true },
  { name: "Labor Day", month: 5, day: 1, isGovernmentHoliday: true },
  { name: "Independence Day", month: 8, day: 15, isGovernmentHoliday: true },
  { name: "Mahatma Gandhi Jayanti", month: 10, day: 2, isGovernmentHoliday: true },
  { name: "Constitution Day", month: 11, day: 26, isGovernmentHoliday: true },
];

/**
 * Idempotently initialize the confirmed 5 government holidays for an organization and year.
 */
export async function initializeDefaultHolidaysForOrg(
  organizationId: mongoose.Types.ObjectId | string,
  year = new Date().getFullYear(),
  createdBy?: mongoose.Types.ObjectId | string
): Promise<{ created: number; existing: number }> {
  let created = 0;
  let existing = 0;

  for (const item of DEFAULT_GOVERNMENT_HOLIDAYS) {
    const holidayDate = new Date(Date.UTC(year, item.month - 1, item.day, 0, 0, 0, 0));

    const found = await Holiday.findOne({
      organizationId,
      date: holidayDate,
    });

    if (found) {
      existing++;
      continue;
    }

    await Holiday.create({
      organizationId,
      name: item.name,
      date: holidayDate,
      year,
      isGovernmentHoliday: item.isGovernmentHoliday,
      status: "ACTIVE",
      createdBy: createdBy || null,
    });
    created++;
  }

  return { created, existing };
}

/**
 * Check if a specific calendar date is a declared holiday for an organization
 */
export async function isDateHoliday(
  organizationId: mongoose.Types.ObjectId | string,
  date: Date
): Promise<IHoliday | null> {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  return Holiday.findOne({
    organizationId,
    status: "ACTIVE",
    date: { $gte: startOfDay, $lte: endOfDay },
  }).lean();
}

/**
 * Get all active holidays for an organization in a given year or range
 */
export async function getHolidaysForOrganization(
  organizationId: mongoose.Types.ObjectId | string,
  options: { year?: number; startDate?: Date; endDate?: Date } = {}
): Promise<IHoliday[]> {
  const query: any = { organizationId, status: "ACTIVE" };

  if (options.year) {
    query.year = options.year;
  }
  if (options.startDate || options.endDate) {
    query.date = {};
    if (options.startDate) query.date.$gte = options.startDate;
    if (options.endDate) query.date.$lte = options.endDate;
  }

  return Holiday.find(query).sort({ date: 1 }).lean();
}

/**
 * Add an official holiday to the organization's holiday calendar
 */
export async function createHoliday(
  currentUser: any,
  payload: {
    name: string;
    date: string | Date;
    isGovernmentHoliday?: boolean;
    description?: string;
    divisionId?: string;
  }
): Promise<IHoliday> {
  const dateObj = new Date(payload.date);
  dateObj.setHours(0, 0, 0, 0);
  const year = dateObj.getFullYear();

  const existing = await Holiday.findOne({
    organizationId: currentUser.organizationId,
    date: dateObj,
  });

  if (existing) {
    throw new Error("HOLIDAY_ALREADY_EXISTS: A holiday on this date already exists in the calendar.");
  }

  return Holiday.create({
    organizationId: currentUser.organizationId,
    divisionId: payload.divisionId || null,
    name: payload.name.trim(),
    date: dateObj,
    year,
    isGovernmentHoliday: payload.isGovernmentHoliday !== false,
    description: payload.description?.trim() || null,
    createdBy: currentUser._id,
    status: "ACTIVE",
  });
}

