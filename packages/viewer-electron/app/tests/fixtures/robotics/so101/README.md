# SO-101 kinematic reference

The unmodified follower definition and a locally formatted copy of the model notes come from
TheRobotStudio/SO-ARM100 revision `a758567c3978dfeefe282ede0500085a48fe8f78`, under
`Simulation/SO101`. The upstream Apache-2.0 license is retained in `LICENSE`. `manifest.json` pins
the original definition, notes, license and all thirteen visual meshes by SHA-256 and byte count.
Meshes are downloaded into a retained local corpus, not checked into this fixture directory. The
repository license is not a completed review of every component's rights for film distribution.

`poses.json` records world transforms for every link at zero and at 25% and 75% of each joint's
declared range. It is calculated from the original XML by `tools/robotics/reference.py`, using
ElementTree and SciPy rotations with NumPy matrix composition. It does not import the Viewer reader
or motion implementation. Regeneration requires NumPy and SciPy and a new output path. Tests read
the retained JSON without Python dependencies.

The selected file uses the upstream new-calibration convention. Its values are metres and radians;
they are not LeRobot's gripper control values or verified physical motor commands. The source
contains a zero-valued link-level origin. Viewer notes that it has no URDF transform semantics and
refuses a nonzero link-level origin instead of guessing.
