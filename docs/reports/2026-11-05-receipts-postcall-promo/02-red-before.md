# Tests rojos sobre la base 4a31c76 (tests nuevos copiados al código base)

## Unit
```
     × libera handoff cuando la llamada termina después de que el cliente eligió chat 4ms
     × conserva el plan elegido al volver 1ms
     × never denies material the capability lists as available and unsent 3ms
       × available, unsent material and no proposed action: not_proposed, and the action stays authorized 5ms
       × already sent and no proposed action: already_sent, not unavailable 1ms
     × rejects an autocorrected email the receipt refused 4ms
     × rejects a refused phone stated as recorded, allows it inside a structured confirmation request 1ms
     × requires send_course_program when the syllabus of the focus course is explained and the material is unsent 0ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 8 ⎯⎯⎯⎯⎯⎯⎯
      Tests  8 failed | 298 passed (306)
```

## Integración (Postgres local desechable)
```
     × handoff blocks a bonus until the latest call is terminal (terminal_call) 11ms
     × after a call (completed) and "sigamos por acá", a current price objection creates exactly one affine offer only once the call is terminal 21ms
     × a proposed phone correction blocks the call until confirmed, then the dispatch carries the corrected number 33ms
     × confirms a corrected known number when the customer confirms the complete delivered candidate 32ms
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 4 ⎯⎯⎯⎯⎯⎯⎯
      Tests  4 failed | 139 passed (143)
```
