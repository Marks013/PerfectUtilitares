import json
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from control import SolveControl, SolveCancelled
from native_runner import NativeError, run_native

REPLY = json.dumps({"httpStatus":200,"body":{"status":"UNKNOWN","assignments":[],"wallTimeSeconds":0}})
PREFIX = b"SOLVERFORGE_PHASE_V1 "

class NativePhaseTests(unittest.TestCase):
    class Control(SolveControl):
        def __init__(self, stop=None):
            super().__init__(threading.Event(), time.monotonic()+3)
            self.phases=[]
            self.stop=stop
        def on_phase(self, phase):
            self.phases.append(phase)
            if phase == self.stop:
                raise SolveCancelled()

    def invoke(self, code, control):
        return run_native({}, control, binary=sys.executable, prefix=("-c",code))

    def test_split_native_events_are_ordered_and_not_part_of_response(self):
        control=self.Control()
        code="import os; data="+repr(PREFIX+b"CONSTRUCTION\n"+PREFIX+b"REFINEMENT\n")+"; [os.write(2,bytes([c])) for c in data]; print("+repr(REPLY)+")"
        result=self.invoke(code,control)
        self.assertEqual(control.phases,["CONSTRUCTION","REFINEMENT"])
        self.assertEqual(result['status'],'UNKNOWN')
        self.assertNotIn('phases',result)

    def test_cancel_on_real_phase_kills_and_reaps_the_owned_child(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'pid'
            code=("import os,time; open("+repr(str(path))+",'w').write(str(os.getpid())); "
                  "os.write(2,"+repr(PREFIX+b"CONSTRUCTION\n"+PREFIX+b"REFINEMENT\n")+"); time.sleep(10)")
            control=self.Control('REFINEMENT')
            with self.assertRaises(SolveCancelled):
                self.invoke(code,control)
            self.assertEqual(control.phases,["CONSTRUCTION","REFINEMENT"])
            self.assertFalse(Path('/proc/'+path.read_text()).exists())

    def test_noise_is_not_exposed_to_phase_callbacks(self):
        control=self.Control()
        self.invoke("import os; os.write(2,"+repr(b"private-noise\n")+"); print("+repr(REPLY)+")",control)
        self.assertEqual(control.phases,[])

    def test_invalid_or_duplicate_protocol_is_rejected_without_payload(self):
        for events in [PREFIX+b'REFINEMENT\n',PREFIX+b'PRIVATE\n',PREFIX+b'CONSTRUCTION\n'+PREFIX+b'CONSTRUCTION\n']:
            control=self.Control()
            with self.subTest(events=events), self.assertRaises(NativeError) as error:
                self.invoke("import os; os.write(2,"+repr(events)+"); print("+repr(REPLY)+")",control)
            self.assertEqual(str(error.exception),'SOLVER_RESPONSE_INVALID')

    def test_stderr_flood_is_bounded(self):
        with self.assertRaises(NativeError) as error:
            self.invoke("import os; os.write(2,b'x'*65536); print("+repr(REPLY)+")",self.Control())
        self.assertEqual(str(error.exception),'SOLVER_RESPONSE_INVALID')
