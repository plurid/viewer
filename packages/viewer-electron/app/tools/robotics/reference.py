"""Independent pose fixtures from XML, NumPy and SciPy; never imports Viewer code."""
import hashlib
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import numpy as np
import scipy
from scipy.spatial.transform import Rotation


def origin(element):
    transform = np.eye(4)
    if element is not None:
        xyz = [float(v) for v in element.get("xyz", "0 0 0").split()]
        rpy = [float(v) for v in element.get("rpy", "0 0 0").split()]
        transform[:3, :3] = Rotation.from_euler("xyz", rpy).as_matrix()
        transform[:3, 3] = xyz
    return transform


source = Path(sys.argv[1]).read_bytes()
robot = ET.fromstring(source)
joints = robot.findall("joint")
moving = [joint for joint in joints if joint.get("type") != "fixed"]
descendants = {joint.find("child").get("link") for joint in joints}
root = next(link.get("name") for link in robot.findall("link") if link.get("name") not in descendants)
cases = []
for fraction in [None, 0.25, 0.75]:
    positions = {}
    for joint in moving:
        limit = joint.find("limit")
        lower, upper = float(limit.get("lower")), float(limit.get("upper"))
        positions[joint.get("name")] = 0 if fraction is None else lower + fraction * (upper - lower)
    transforms = {root: np.eye(4)}
    remaining = list(joints)
    while remaining:
        ready = [j for j in remaining if j.find("parent").get("link") in transforms]
        if not ready:
            raise ValueError("Disconnected tree")
        for joint in ready:
            motion = np.eye(4)
            if joint.get("type") != "fixed":
                axis = np.array([float(v) for v in joint.find("axis").get("xyz").split()])
                axis /= np.linalg.norm(axis)
                value = positions[joint.get("name")]
                if joint.get("type") == "prismatic":
                    motion[:3, 3] = axis * value
                else:
                    motion[:3, :3] = Rotation.from_rotvec(axis * value).as_matrix()
            parent = joint.find("parent").get("link")
            child = joint.find("child").get("link")
            transforms[child] = transforms[parent] @ origin(joint.find("origin")) @ motion
            remaining.remove(joint)
    cases.append({"positions": positions, "links": {k: v.flatten(order="F").tolist() for k, v in transforms.items()}})

result = {"sourceSHA256": hashlib.sha256(source).hexdigest(), "reference": {"numpy": np.__version__, "scipy": scipy.__version__}, "cases": cases}
with Path(sys.argv[2]).open("x") as output:
    json.dump(result, output, indent=2)
    output.write("\n")
