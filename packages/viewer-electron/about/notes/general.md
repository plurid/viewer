Finite State Machine for Milling and Mixing (Deterministic Finite Automaton)


Inputs:

```
I0. Mill Motor Start
I1. Mill Motor Stop
I2. Mixer Motor Start
I3. Mixer Motor Stop
I4. Mixer Scale Increase
I5. Mixer Scale Decrease
I6. Time Increase
```


States:

```
S0. Nothing, Mill and Mixer Motor Not Running
S1. Nothing, Mill Motor Running, Mixer Motor Not Running
S2. Nothing, Mill and Mixer Motor Running
S3. Nothing, Mill Motor Not Running, Mixer Motor Running
S4. Loading from Bunker 1, Mill and Mixer Motor Running
S5. Loading from Bunker 2, Mill and Mixer Motor Running
S6. Loading from Bunker 3, Mill and Mixer Motor Running
S7. Loading from Bunker 4, Mill and Mixer Motor Running
S8. Mixing Timed Amount, Mill Motor Not Running, Mixer Motor Running
```


The Initial State: `S0`

The Final State: `S0`



---



Statistics

in time = in the last day/last 30 days/all time

+ kWh consumed in time
+ most used recipe in time
+ kgs processed on the mill in time
+ packages today
