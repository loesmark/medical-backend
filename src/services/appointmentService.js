/**
 * AppointmentService — list available slots + patient request/cancel/list +
 * admin confirm (generate whatsapp_link) / cancel.
 *
 * Slot generation:
 *   - Read doctor_working_hours for the requested day_of_week.
 *   - If no row OR is_active=0 → no slots that day.
 *   - Otherwise generate 30-minute slots between start_time and end_time.
 *   - Exclude times that already have a 'requested' or 'confirmed'
 *     appointment on the requested date.
 *
 * Slot length (30 min) is a constant below — bumpable without schema change.
 */

const { v4: uuidv4 } = require('uuid');

const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');

const appointmentRepo = require('../repositories/appointmentRepository');
const userRepo = require('../repositories/userRepository');
const settingsRepo = require('../repositories/settingsRepository');
const audit = require('../middleware/auditLog');

const SLOT_LENGTH_MIN = 30;

// "09:00" → minutes since midnight
function toMinutes(hhmm) {
  if (!hhmm) return null;
  const m = String(hhmm).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function fromMinutes(total) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function dayOfWeek(dateStr) {
  // JS: 0=Sunday..6=Saturday — matches the schema's CHECK constraint.
  const d = new Date(dateStr + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return null;
  return d.getUTCDay();
}

module.exports = {
  // ── Patient: list available slots for a date ──
  listAvailableSlots(userId, { date } = {}) {
    if (!date) throw ApiError.badRequest('VALIDATION_FAILED', 'date is required (YYYY-MM-DD).');
    const dow = dayOfWeek(date);
    if (dow == null) throw ApiError.badRequest('VALIDATION_FAILED', 'Invalid date format. Use YYYY-MM-DD.');

    const wh = appointmentRepo.getWorkingHoursByDay(dow);
    if (!wh || !wh.is_active) {
      return { date, day_of_week: dow, slots: [] };
    }

    const start = toMinutes(wh.start_time);
    const end = toMinutes(wh.end_time);
    if (start == null || end == null || end <= start) {
      return { date, day_of_week: dow, slots: [] };
    }

    const booked = new Set(appointmentRepo.bookedTimesForDate(date));
    const slots = [];
    for (let t = start; t + SLOT_LENGTH_MIN <= end; t += SLOT_LENGTH_MIN) {
      const label = fromMinutes(t);
      slots.push({
        start: label,
        end: fromMinutes(t + SLOT_LENGTH_MIN),
        available: !booked.has(label),
      });
    }
    return { date, day_of_week: dow, slots };
  },

  // ── Patient: request an appointment ──
  request({ userId, scheduled_date, scheduled_time, notes }) {
    if (!scheduled_date || !scheduled_time) {
      throw ApiError.badRequest('VALIDATION_FAILED', 'scheduled_date and scheduled_time are required.');
    }
    const dow = dayOfWeek(scheduled_date);
    if (dow == null) throw ApiError.badRequest('VALIDATION_FAILED', 'Invalid date format. Use YYYY-MM-DD.');
    if (!/^\d{2}:\d{2}$/.test(scheduled_time)) {
      throw ApiError.badRequest('VALIDATION_FAILED', 'scheduled_time must be HH:MM.');
    }

    const wh = appointmentRepo.getWorkingHoursByDay(dow);
    if (!wh || !wh.is_active) {
      throw ApiError.badRequest('NO_WORKING_HOURS', 'The doctor is not available on this day of the week.');
    }

    const booked = new Set(appointmentRepo.bookedTimesForDate(scheduled_date));
    if (booked.has(scheduled_time)) {
      throw ApiError.conflict('SLOT_TAKEN', 'This time slot is already booked.');
    }

    const id = uuidv4();
    appointmentRepo.insert({
      id,
      patientId: userId,
      scheduledDate: scheduled_date,
      scheduledTime: scheduled_time,
      status: 'requested',
      notes,
    });
    logger.info('appointmentService', `Appointment requested: ${userId} → ${scheduled_date} ${scheduled_time}`);
    return { appointment_id: id, status: 'requested' };
  },

  // ── Patient: list own appointments ──
  listByUser(userId, { page = 1, limit = 20 } = {}) {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const safeOffset = (Math.max(page, 1) - 1) * safeLimit;
    const rows = appointmentRepo.listByPatient(userId, safeLimit, safeOffset);
    const total = appointmentRepo.countByPatient(userId);
    return { appointments: rows, total, page, limit: safeLimit };
  },

  cancel({ userId, appointmentId }) {
    const appt = appointmentRepo.getById(appointmentId);
    if (!appt) throw ApiError.notFound('APPOINTMENT_NOT_FOUND', 'Appointment not found.');
    if (appt.patient_id !== userId) {
      throw ApiError.forbidden('AUTH_FORBIDDEN', 'You can only cancel your own appointments.');
    }
    if (appt.status === 'cancelled') {
      return { id: appointmentId, status: 'cancelled' };
    }
    if (appt.status === 'completed') {
      throw ApiError.badRequest('CANNOT_CANCEL_COMPLETED', 'Completed appointments cannot be cancelled.');
    }
    appointmentRepo.cancel(appointmentId);
    return { id: appointmentId, status: 'cancelled' };
  },

  // ── Admin ──
  listAll({ page = 1, limit = 20, status, date } = {}) {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const safeOffset = (Math.max(page, 1) - 1) * safeLimit;
    const rows = appointmentRepo.listAll({ status, date, limit: safeLimit, offset: safeOffset });
    const total = appointmentRepo.countAll({ status, date });
    return { appointments: rows, total, page, limit: safeLimit };
  },

  confirm(appointmentId, { actorId, actorIp } = {}) {
    const appt = appointmentRepo.getByIdJoined(appointmentId);
    if (!appt) throw ApiError.notFound('APPOINTMENT_NOT_FOUND', 'Appointment not found.');
    if (appt.status === 'cancelled') {
      throw ApiError.badRequest('APPOINTMENT_CANCELLED', 'Cannot confirm a cancelled appointment.');
    }
    if (appt.status === 'confirmed') {
      return { id: appointmentId, status: 'confirmed' };
    }
    // Build the WhatsApp deep link to the patient's phone with a pre-filled
    // confirmation message — the doctor taps → WhatsApp opens → patient gets
    // the appointment confirmation.
    const phone = (appt.patient_phone || '').replace(/[^\d]/g, '');
    const msg = `Your appointment on ${appt.scheduled_date} at ${appt.scheduled_time} is confirmed. We look forward to seeing you.`;
    const whatsappLink = phone ? `https://wa.me/${phone}?text=${encodeURIComponent(msg)}` : null;
    appointmentRepo.confirm(appointmentId, whatsappLink);
    if (actorId) {
      audit.log({
        actorId, actorIp,
        action: 'APPOINTMENT_CONFIRMED', target: appointmentId, status: 'success',
        meta: { patient_id: appt.patient_id, date: appt.scheduled_date, time: appt.scheduled_time },
      });
    }
    return { id: appointmentId, status: 'confirmed', whatsapp_link: whatsappLink };
  },

  adminCancel(appointmentId, { actorId, actorIp } = {}) {
    const appt = appointmentRepo.getById(appointmentId);
    if (!appt) throw ApiError.notFound('APPOINTMENT_NOT_FOUND', 'Appointment not found.');
    appointmentRepo.cancel(appointmentId);
    if (actorId) {
      audit.log({
        actorId, actorIp,
        action: 'APPOINTMENT_CANCELLED', target: appointmentId, status: 'success',
        meta: { patient_id: appt.patient_id },
      });
    }
    return { id: appointmentId, status: 'cancelled' };
  },

  // ── Doctor working hours (admin) ──
  listWorkingHours() {
    return appointmentRepo.listWorkingHours();
  },

  upsertWorkingHours({ day_of_week, start_time, end_time, is_active = true }) {
    if (day_of_week == null || day_of_week < 0 || day_of_week > 6) {
      throw ApiError.badRequest('VALIDATION_FAILED', 'day_of_week must be 0-6 (0=Sunday).');
    }
    if (!start_time || !end_time) {
      throw ApiError.badRequest('VALIDATION_FAILED', 'start_time and end_time are required (HH:MM).');
    }
    return appointmentRepo.upsertWorkingHours({
      dayOfWeek: day_of_week,
      startTime: start_time,
      endTime: end_time,
      isActive: is_active,
    });
  },

  // ── Doctor availability status (stored in settings as doctor_availability_status) ──
  getAvailabilityStatus() {
    const v = settingsRepo.get('doctor_availability_status');
    return { status: v || 'available' };
  },
  setAvailabilityStatus(status) {
    if (!['available', 'unavailable', 'busy'].includes(status)) {
      throw ApiError.badRequest('VALIDATION_FAILED', 'status must be "available" | "unavailable" | "busy".');
    }
    settingsRepo.upsert('doctor_availability_status', status);
    return { status };
  },
};
