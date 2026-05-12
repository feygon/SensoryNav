# Map Module Wardley Analysis

## TLDR

The map module should not be a new map app from scratch.

The valuable part is the **sensory comfort layer**:

- road-noise interpretation
- per-car calibration
- gyroscopic incident detection
- smooth-road discovery
- sensory-profile routing
- overwhelming-intersection avoidance

Buy or reuse the base map, routing, sensors, DSP libraries, and map matching.

Build the sensory interpretation and personalization layer.

## Wardley Evolution Key

| Stage | Meaning |
|---|---|
| Genesis | Novel, uncertain, research-heavy |
| Custom-built | Differentiating but buildable |
| Product | Mature tools/vendors exist |
| Commodity | Standard utility |

## Component Map

| Component | Evolution | Why | Build / Buy |
|---|---:|---|---|
| Base map tiles | Product / Commodity | Rendering maps is solved. | Buy/use Mapbox, Google, or OSM stack. |
| Turn-by-turn routing | Product | Routing engines already exist. | Buy/use API or open router. |
| Map matching | Product | Matching traces to roads is a known problem. | Buy/use existing. |
| GPS capture | Commodity | OS APIs expose this. | Use platform APIs. |
| Microphone capture | Commodity | Standard mobile capability. | Use OS APIs. |
| Gyroscope / accelerometer capture | Commodity | Standard mobile capability. | Use OS APIs. |
| FFT / frequency transforms | Commodity / Product | DSP libraries already solve this. | Use libraries. |
| Road-noise frequency bands | Product -> Custom-built | Band measurement is standard; meaningful bands for sensory comfort are not. | Build your band model. |
| Per-car frequency filters | Genesis -> Custom-built | Cabin, tires, suspension, speed, and phone mount all distort signal. | Build. Core differentiator. |
| Road-noise incident detection | Custom-built | Needs to convert sound patterns into mapped comfort/roughness signals. | Build. |
| Gyroscopic incident detection | Product -> Custom-built | Bump detection exists; sensory interpretation is yours. | Build on known methods. |
| Per-car gyro calibration | Genesis -> Custom-built | Suspension and phone mount dominate the signal. | Build. |
| Audio + gyro sensor fusion | Genesis | Combining sound and vibration into comfort is novel. | Invest heavily. |
| Smooth-road detection | Genesis | The emotional hook is finding wonderful smooth roads, not only avoiding hazards. | Build. |
| Fresh asphalt likelihood | Genesis | Construction completion, sensor traces, and user feedback need probabilistic fusion. | Build. |
| Construction data import | Product | DOT/city/OSM feeds already exist, though unevenly. | Import/buy. |
| Pothole data import | Product | Some cities/vendors already publish or sell this. | Import where available. |
| OSM surface/smoothness tags | Product / Commodity | Existing road metadata taxonomy. | Import. |
| User feedback for sensory profiles | Custom-built | Subjective comfort must become structured data. | Build. |
| Overwhelming intersection reports | Genesis | Existing maps rarely model cognitive/sensory load. | Build. |
| Intersection complexity scoring | Custom-built | Can derive from lanes, turn geometry, speed, signals, and user feedback. | Build on map data. |
| Sensory route weighting | Custom-built | Existing routers can route; your cost function is novel. | Build on router. |
| Confidence scoring | Custom-built | Needed to distinguish one noisy sample from reliable truth. | Build early. |

## Components You Should Not Hand-Build

- Base maps
- Turn-by-turn routing
- General GPS tracking
- Raw microphone capture
- Raw IMU capture
- FFT and standard filters
- General map matching
- Basic storage/auth/admin tooling
- Public construction feed ingestion where vendor/open data exists

## Components Worth Hand-Building

- Per-car road-noise calibration
- Adaptive frequency-band filters
- Speed-normalized road-noise scores
- Gyroscopic roughness interpretation
- Audio + gyro sensor fusion
- Smooth-road detection
- Fresh asphalt likelihood
- Sensory profile model
- Overwhelming-intersection scoring
- Sensory route cost function
- Confidence/decay model for road-segment truth

## Underinvestment Risks

### 1. Calibration

This is probably the hard part.

The same road will sound and feel different depending on:

- vehicle
- tires
- suspension
- speed
- phone mount
- cabin acoustics
- EV vs gas engine
- weather
- open windows

Without calibration, the system may confuse car noise with road texture.

### 2. Positive Smoothness

Most road-quality systems focus on defects.

Your novel hook is:

> route me through the smooth, fresh asphalt roads.

This should be a first-class score, not just the absence of potholes.

### 3. Incident Semantics

A spike is not enough.

The system should eventually distinguish:

- pothole
- rough asphalt
- gravel texture
- bridge seam
- speed bump
- rumble strip
- construction plate
- smooth fresh asphalt

### 4. Sensory Profiles

Different users may care about different discomforts:

- vibration
- road noise
- sudden bumps
- visual complexity
- stressful turns
- complex intersections
- difficult pullouts

The product should not have only one universal comfort score.

### 5. Confidence

Every road segment should know how trustworthy its score is.

Useful confidence inputs:

- number of observations
- recency
- car/device diversity
- speed range
- agreement between audio and gyro
- user confirmations
- weather contamination risk

## Suggested Pipeline

1. Capture raw GPS, audio bands, and IMU data.
2. Normalize by speed, vehicle, and phone position.
3. Detect road-noise and gyroscopic incidents.
4. Match incidents to road segments.
5. Cluster repeated events.
6. Score each segment for comfort, roughness, freshness, and confidence.
7. Apply user sensory profile.
8. Route using existing routing plus custom sensory weights.

