/**
 * AppointmentRepository — appointments CRUD + doctor_working_hours.
 *
 * v3 schema:
 *   appointments: patient_id (= users.id), scheduled_date (DATE),
 *     scheduled_time (TEXT "14:30"), status (requested|confirmed|cancelled|completed),
 *     whatsapp_link, notes, confirmed_at.
 *
 *   doctor_working_hours: UNIQUE(day_of_week 0..6). One row per weekday.
 *     Used by appointmentService to compute available slots per date.
 */

const db = require('../db');

const stmts = {
  // ── Appointments ──
  insert: db.prepare(
    `INSERT INTO appointments
       (id, patient_id, scheduled_date, scheduled_time, status, notes)
     VALUES (?, ?, ?, ?, ?, ?)`
  ),
  confirm: db.prepare(
    `UPDATE appointments
        SET status = 'confirmed', confirmed_at = CURRENT_TIMESTAMP, whatsapp_link = ?
      WHERE id = ?`
  ),
  cancel: db.prepare(`UPDATE appointments SET status = 'cancelled' WHERE id = ?`),
  getById: db.prepare(`SELECT * FROM appointments WHERE id = ?`),
  getByIdJoined: db.prepare(`
    SELECT a.*, u.name AS patient_name, u.phone_number AS patient_phone, u.status AS patient_status
    FROM appointments a
    JOIN users u ON u.id = a.patient_id
    WHERE a.id = ?
  `),
  listByPatient: db.prepare(
    `SELECT * FROM appointments
     WHERE patient_id = ?
     ORDER BY scheduled_date DESC, scheduled_time DESC, id DESC
     LIMIT ? OFFSET ?`
  ),
  countByPatient: db.prepare(`SELECT COUNT(*) as c FROM appointments WHERE patient_id = ?`),
  listAll: db.prepare(`
    SELECT a.*, u.name AS patient_name, u.phone_number AS patient_phone, u.status AS patient_status
    FROM appointments a
    JOIN users u ON u.id = a.patient_id
    ORDER BY a.scheduled_date DESC, a.scheduled_time DESC, a.id DESC
    LIMIT ? OFFSET ?
  `),
  listAllFiltered: db.prepare(`
    SELECT a.*, u.name AS patient_name, u.phone_number AS patient_phone, u.status AS patient_status
    FROM appointments a
    JOIN users u ON u.id = a.patient_id
    WHERE 1=1
      AND (@status IS NULL OR a.status = @status)
      AND (@date IS NULL OR a.scheduled_date = @date)
    ORDER BY a.scheduled_date DESC, a.scheduled_time DESC, a.id DESC
    LIMIT @limit OFFSET @offset
  `),
  countAll: db.prepare(`SELECT COUNT(*) as c FROM appointments`),
  countAllFiltered: db.prepare(`
    SELECT COUNT(*) as c
    FROM appointments a
    WHERE 1=1
      AND (@status IS NULL OR a.status = @status)
      AND (@date IS NULL OR a.scheduled_date = @date)
  `),

  // ── Slot availability: booked times for a given date (status NOT cancelled) ──
  bookedTimesForDate: db.prepare(
    `SELECT scheduled_time
     FROM appointments
     WHERE scheduled_date = ?
       AND status IN ('requested','confirmed')
     ORDER BY scheduled_time ASC`
  ),

  // ── Doctor working hours (one row per weekday, UNIQUE) ──
  listWorkingHours: db.prepare(
    `SELECT * FROM doctor_working_hours ORDER BY day_of_week ASC`
  ),
  getWorkingHoursByDay: db.prepare(
    `SELECT * FROM doctor_working_hours WHERE day_of_week = ?`
  ),
  upsertWorkingHours: db.prepare(
    `INSERT INTO doctor_working_hours (day_of_week, start_time, end_time, is_active)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(day_of_week) DO UPDATE SET
       start_time = excluded.start_time,
       end_time   = excluded.end_time,
       is_active  = excluded.is_active`
  ),
  setWorkingHoursActive: db.prepare(
    `UPDATE doctor_working_hours SET is_active = ? WHERE day_of_week = ?`
  ),
};

module.exports = {
  insert({ id, patientId, scheduledDate, scheduledTime, status, notes }) {
    stmts.insert.run(
      id,
      patientId,
      scheduledDate,
      scheduledTime,
      status || 'requested',
      notes || null
    );
  },
  confirm(id, whatsappLink) { return stmts.confirm.run(whatsappLink || null, id); },
  cancel(id) { return stmts.cancel.run(id); },
  getById(id) { return stmts.getById.get(id) || null; },
  getByIdJoined(id) { return stmts.getByIdJoined.get(id) || null; },

  listByPatient(patientId, limit, offset) {
    return stmts.listByPatient.all(patientId, limit, offset);
  },
  countByPatient(patientId) {
    return stmts.countByPatient.get(patientId).c;
  },

  listAll({ status, date, limit, offset }) {
    return stmts.listAllFiltered.all({
      status: status || null,
      date: date || null,
      limit,
      offset,
    });
  },
  countAll({ status, date }) {
    return stmts.countAllFiltered.get({
      status: status || null,
      date: date || null,
    }).c;
  },

  bookedTimesForDate(date) { return stmts.bookedTimesForDate.all(date).map((r) => r.scheduled_time); },

  listWorkingHours() { return stmts.listWorkingHours.all(); },
  getWorkingHoursByDay(day) { return stmts.getWorkingHoursByDay.get(day) || null; },
  upsertWorkingHours({ dayOfWeek, startTime, endTime, isActive = true }) {
    return stmts.upsertWorkingHours.run(dayOfWeek, startTime, endTime, isActive ? 1 : 0);
  },
  setWorkingHoursActive(dayOfWeek, isActive) {
    return stmts.setWorkingHoursActive.run(isActive ? 1 : 0, dayOfWeek);
  },
};
