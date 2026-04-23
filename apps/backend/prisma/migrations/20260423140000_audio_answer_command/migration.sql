-- Migration: audio_answer_command
-- Adds AUDIO_ANSWER value to DeviceCommandType enum.
-- Required for v0.32.1: deliver SDP-answer to child device via DeviceCommand poll
-- so child can complete WebRTC handshake (Plan B mobile-child).

ALTER TYPE "DeviceCommandType" ADD VALUE 'AUDIO_ANSWER';
