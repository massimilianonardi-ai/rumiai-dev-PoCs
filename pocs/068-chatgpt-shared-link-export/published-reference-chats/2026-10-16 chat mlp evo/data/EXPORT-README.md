# ChatGPT conversation export

Raw structured snapshot, renderer-visible transcript, turn-surface structure and non-text parts are retained.
TURN_SURFACES.jsonl separates user/final-response surfaces from activity/tool/reasoning metadata.
Internal reasoning text is not promoted into the readable transcript.
MEDIA.json separates public image retrieval from user-upload assets deferred to authenticated export. Downloaded binaries live under media/.
FILES.json records assistant sandbox files; downloaded binaries live under files/.
Missing artifacts remain explicit and do not make the export silently complete.
