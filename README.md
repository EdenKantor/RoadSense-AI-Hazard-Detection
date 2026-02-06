# RoadSenseAI — Collaborative Pothole Detection & Mapping (Capstone)

RoadSenseAI is a collaborative system for detecting potholes from road trip videos, turning raw detections into **clean, deduplicated road events**, and presenting them on a map dashboard for both citizens and municipalities.

**Project Code:** 26-1-D-9  
**Authors:** Eden Kantor, Noa Sivan  
**Repository Purpose:** This repo hosts the **Project Book** and supporting documentation/artifacts for academic submission.

---

## Why this project?
Potholes are a common road hazard, but manual reporting is slow and inconsistent.  
RoadSenseAI proposes an automated, scalable approach: use computer vision + GPS alignment to produce reliable “pothole events” that can be tracked and managed.

---

## What RoadSenseAI delivers (in one view)
- **Citizen flow:** upload a trip (video + GPS), view processing status, see detected events on the map
- **Authority flow:** review events, manage lifecycle status (Reported → Verified → In Progress → Fixed → Closed)
- **Map view:** shared pothole map with deduplicated event markers (not noisy frame-level detections)

---

## Core features
- **Pothole detection:** YOLO-based inference on sampled video frames
- **Geo-alignment:** match detections to GPS by timestamps (with interpolation when needed)
- **Dedup & merge:** cluster nearby detections into a single event (reduces duplicate markers)
- **Event model:** each event includes location, confidence/severity proxy, timestamps, and status
- **Dashboard-ready data:** events are stored in a map-friendly format (GeoJSON)

