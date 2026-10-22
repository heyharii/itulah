-- 0081: A shared session is read by its name.
--
-- Two or three handhelds counting one rack each ask the node, every two
-- seconds, what the session has found so far (`GET /api/v1/rfid/sessions/{id}`,
-- `edge::rfid::EdgeRfid::session`), and the packing bench reads a box's sweep
-- the same way (`edge::outbound`). Every one of those reads filters
-- `edge_observation_sighting` by `reader_session_id`, and no index led with it:
-- 0004's burst index leads with the device, 0064's with the device and the
-- time. So each poll scanned every sighting the node had ever filed — a table
-- that only grows — once per handheld, every two seconds, all day.
--
-- The EPC second, because the list of distinct tags a session found is then
-- read straight off the index, in order.
--
-- Creates only, so it runs on every open. On a node that has filed a great
-- deal it takes a moment, once, at the first start after this ships.

CREATE INDEX IF NOT EXISTS edge_observation_session_idx
    ON edge_observation_sighting (reader_session_id, epc);
