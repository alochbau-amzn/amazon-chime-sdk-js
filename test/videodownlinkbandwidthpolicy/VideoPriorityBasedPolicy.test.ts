// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as chai from 'chai';

import { VideoDownlinkObserver } from '../../src';
import AudioVideoTileController from '../../src/audiovideocontroller/AudioVideoController';
import NoOpAudioVideoTileController from '../../src/audiovideocontroller/NoOpAudioVideoController';
import ClientMetricReportDirection from '../../src/clientmetricreport/ClientMetricReportDirection';
import DefaultClientMetricReport from '../../src/clientmetricreport/DefaultClientMetricReport';
import GlobalMetricReport from '../../src/clientmetricreport/GlobalMetricReport';
import StreamMetricReport from '../../src/clientmetricreport/StreamMetricReport';
import NoOpDebugLogger from '../../src/logger/NoOpDebugLogger';
import TimeoutScheduler from '../../src/scheduler/TimeoutScheduler';
import {
  SdkBitrate,
  SdkBitrateFrame,
  SdkIndexFrame,
  SdkStreamDescriptor,
  SdkStreamMediaType,
} from '../../src/signalingprotocol/SignalingProtocol';
import SimulcastLayers from '../../src/simulcastlayers/SimulcastLayers';
import VideoPreference from '../../src/videodownlinkbandwidthpolicy/VideoPreference';
import VideoPriorityBasedPolicy from '../../src/videodownlinkbandwidthpolicy/VideoPriorityBasedPolicy';
import SimulcastVideoStreamIndex from '../../src/videostreamindex/SimulcastVideoStreamIndex';
import VideoTileController from '../../src/videotilecontroller/VideoTileController';

const delay = async (timeoutMs: number = 100): Promise<void> => {
  await new Promise(resolve => new TimeoutScheduler(timeoutMs).start(resolve));
};

describe('VideoPriorityBasedPolicy', () => {
  const expect: Chai.ExpectStatic = chai.expect;
  const assert: Chai.AssertStatic = chai.assert;
  const logger = new NoOpDebugLogger();
  let policy: VideoPriorityBasedPolicy;
  let videoStreamIndex: SimulcastVideoStreamIndex;
  let audioVideoController: AudioVideoTileController;
  let tileController: VideoTileController;

  interface DateNow {
    (): number;
  }
  let originalDateNow: DateNow;
  let startTime: number;

  function mockDateNow(): number {
    return startTime;
  }

  function incrementTime(addMs: number): void {
    startTime += addMs;
  }

  function updateIndexFrame(
    index: SimulcastVideoStreamIndex,
    remoteClientCnt: number,
    lowSimulRate: number,
    highSimulRate: number
  ): void {
    const sources: SdkStreamDescriptor[] = [];
    for (let i = 1; i < remoteClientCnt + 1; i++) {
      const attendee = `attendee-${i}`;
      if (lowSimulRate > 0) {
        sources.push(
          new SdkStreamDescriptor({
            streamId: 2 * i - 1,
            groupId: i,
            maxBitrateKbps: lowSimulRate,
            avgBitrateBps: lowSimulRate * 1000,
            attendeeId: attendee,
            mediaType: SdkStreamMediaType.VIDEO,
          })
        );
      }
      if (highSimulRate > 0) {
        sources.push(
          new SdkStreamDescriptor({
            streamId: 2 * i,
            groupId: i,
            maxBitrateKbps: highSimulRate,
            avgBitrateBps: highSimulRate * 1000,
            attendeeId: attendee,
            mediaType: SdkStreamMediaType.VIDEO,
          })
        );
      }
    }
    index.integrateIndexFrame(
      new SdkIndexFrame({ sources: sources, numParticipants: remoteClientCnt })
    );
  }

  function updateBitrateFrame(
    remoteClientCnt: number,
    lowSimulRate: number,
    highSimulRate: number
  ): SdkBitrateFrame {
    const bitrateFrame = SdkBitrateFrame.create();
    for (let i = 1; i < remoteClientCnt + 1; i++) {
      if (lowSimulRate > 0) {
        const bitrate = SdkBitrate.create();
        bitrate.sourceStreamId = 2 * i - 1;
        bitrate.avgBitrateBps = lowSimulRate * 1000;
        bitrateFrame.bitrates.push(bitrate);
      }
      if (highSimulRate > 0) {
        const bitrate2 = SdkBitrate.create();
        bitrate2.sourceStreamId = 2 * i;
        bitrate2.avgBitrateBps = highSimulRate * 1000;
        bitrateFrame.bitrates.push(bitrate2);
      }
    }
    return bitrateFrame;
  }

  function setPacketLoss(
    metricReport: DefaultClientMetricReport,
    nackCnt: number,
    packetsLost: number
  ): void {
    metricReport.currentTimestampMs = 2000;
    metricReport.previousTimestampMs = 1000;
    const streamReport1 = new StreamMetricReport();
    streamReport1.streamId = 1;
    streamReport1.direction = ClientMetricReportDirection.DOWNSTREAM;
    streamReport1.previousMetrics['googNacksSent'] = 0;
    streamReport1.previousMetrics['packetsLost'] = 0;
    streamReport1.currentMetrics['googNacksSent'] = nackCnt;
    streamReport1.currentMetrics['packetsLost'] = packetsLost;
    streamReport1.currentMetrics['googFrameRateReceived'] = 15;
    streamReport1.currentMetrics['bytesReceived'] = 200;

    metricReport.streamMetricReports[1] = streamReport1;
  }

  beforeEach(() => {
    startTime = Date.now();
    originalDateNow = Date.now;
    Date.now = mockDateNow;
    audioVideoController = new NoOpAudioVideoTileController();
    tileController = audioVideoController.videoTileController;
    policy = new VideoPriorityBasedPolicy(logger);
    policy.setTileController(tileController);
    videoStreamIndex = new SimulcastVideoStreamIndex(logger);
  });

  afterEach(() => {
    Date.now = originalDateNow;
  });

  describe('construction', () => {
    it('can be constructed', () => {
      assert.exists(policy);
    });
  });

  describe('reset', () => {
    it('can be reset', () => {
      updateIndexFrame(videoStreamIndex, 6, 0, 600);
      policy.updateIndex(videoStreamIndex);
      const preferences: VideoPreference[] = [];
      preferences.push(new VideoPreference('attendee-1', 1, SimulcastLayers.High));
      policy.chooseRemoteVideoSources(preferences);
      const resub = policy.wantsResubscribe();
      expect(resub).to.equal(true);
      let received = policy.chooseSubscriptions();
      expect(received.array()).to.deep.equal([2]);
      policy.reset();
      received = policy.chooseSubscriptions();
      expect(received.array()).to.deep.equal([]);
    });
  });

  describe('worksWithoutTileController', () => {
    it('runs without tile controller', () => {
      const policy = new VideoPriorityBasedPolicy(logger);
      updateIndexFrame(videoStreamIndex, 6, 0, 600);
      policy.updateIndex(videoStreamIndex);
      const preferences: VideoPreference[] = [];
      preferences.push(new VideoPreference('attendee-1', 1, SimulcastLayers.High));
      policy.chooseRemoteVideoSources(preferences);
      const resub = policy.wantsResubscribe();
      expect(resub).to.equal(true);
      const received = policy.chooseSubscriptions();
      expect(received.array()).to.deep.equal([2]);
    });
  });

  describe('callsObserverForResubscribe', () => {
    it('observer should get called only when added', async () => {
      let called = 0;
      class TestObserver implements VideoDownlinkObserver {
        wantsResubscribe(): void {
          called += 1;
        }
      }
      const observer = new TestObserver();
      policy.addObserver(observer);
      policy.forEachObserver((observer: VideoDownlinkObserver) => {
        observer.wantsResubscribe();
      });
      await delay();
      expect(called).to.equal(1);
      policy.removeObserver(observer);
      policy.forEachObserver((observer: VideoDownlinkObserver) => {
        observer.wantsResubscribe();
      });
      await delay();
      expect(called).to.equal(1);
      policy.addObserver(observer);
      policy.forEachObserver((observer: VideoDownlinkObserver) => {
        observer.wantsResubscribe();
      });
      await delay();
      policy.forEachObserver((observer: VideoDownlinkObserver) => {
        observer.wantsResubscribe();
      });
      policy.removeObserver(observer);
      await delay();
      policy.addObserver(observer);
      policy.forEachObserver((observer: VideoDownlinkObserver) => {
        observer.wantsResubscribe();
      });
      await delay();
      expect(called).to.equal(3);
    });

    it('observer called when preference changes', async () => {
      let called = 0;
      class TestObserver implements VideoDownlinkObserver {
        wantsResubscribe(): void {
          called += 1;
        }
      }
      const observer = new TestObserver();
      policy.addObserver(observer);
      updateIndexFrame(videoStreamIndex, 4, 0, 600);
      policy.updateIndex(videoStreamIndex);
      const metricReport = new DefaultClientMetricReport(logger);
      metricReport.globalMetricReport = new GlobalMetricReport();
      metricReport.globalMetricReport.currentMetrics['googAvailableReceiveBandwidth'] = 2400 * 1000;
      policy.updateMetrics(metricReport);
      const preferences: VideoPreference[] = [];
      preferences.push(new VideoPreference('attendee-3', 1));
      policy.chooseRemoteVideoSources(preferences);
      await delay();
      expect(called).to.equal(1);
    });
  });

  describe('priority on off same', () => {
    it('no priority to priority', () => {
      updateIndexFrame(videoStreamIndex, 5, 0, 600);
      policy.updateIndex(videoStreamIndex);
      const metricReport = new DefaultClientMetricReport(logger);
      metricReport.globalMetricReport = new GlobalMetricReport();
      metricReport.globalMetricReport.currentMetrics['googAvailableReceiveBandwidth'] = 2400 * 1000;
      policy.updateMetrics(metricReport);
      let resub = policy.wantsResubscribe();
      expect(resub).to.equal(false);
      let received = policy.chooseSubscriptions();
      expect(received.array()).to.deep.equal([]);

      incrementTime(6100);
      metricReport.globalMetricReport.currentMetrics['googAvailableReceiveBandwidth'] = 2400 * 1000;
      policy.updateMetrics(metricReport);
      resub = policy.wantsResubscribe();
      expect(resub).to.equal(false);

      const preferences: VideoPreference[] = [];
      preferences.push(new VideoPreference('attendee-5', 1));
      policy.chooseRemoteVideoSources(preferences);
      resub = policy.wantsResubscribe();
      expect(resub).to.equal(true);
      received = policy.chooseSubscriptions();
      expect(received.array()).to.deep.equal([10]);
    });

    it('priority to no priority', () => {
      updateIndexFrame(videoStreamIndex, 4, 0, 600);
      policy.updateIndex(videoStreamIndex);
      const metricReport = new DefaultClientMetricReport(logger);
      metricReport.globalMetricReport = new GlobalMetricReport();
      metricReport.globalMetricReport.currentMetrics['googAvailableReceiveBandwidth'] = 2400 * 1000;
      policy.updateMetrics(metricReport);
      let preferences: VideoPreference[] = [];
      preferences.push(new VideoPreference('attendee-3', 1));
      policy.chooseRemoteVideoSources(preferences);
      let resub = policy.wantsResubscribe();
      expect(resub).to.equal(true);
      let received = policy.chooseSubscriptions();
      expect(received.array()).to.deep.equal([6]);

      incrementTime(6100);
      metricReport.globalMetricReport.currentMetrics['googAvailableReceiveBandwidth'] = 2400 * 1000;
      policy.updateMetrics(metricReport);
      preferences = [];
      policy.chooseRemoteVideoSources(preferences);
      resub = policy.wantsResubscribe();
      expect(resub).to.equal(true);
      received = policy.chooseSubscriptions();
      expect(received.array()).to.deep.equal([]);
    });

    it('priority value comparison checker', () => {
      updateIndexFrame(videoStreamIndex, 4, 0, 600);
      policy.updateIndex(videoStreamIndex);
      const metricReport = new DefaultClientMetricReport(logger);
      metricReport.globalMetricReport = new GlobalMetricReport();
      metricReport.globalMetricReport.currentMetrics['googAvailableReceiveBandwidth'] = 2400 * 1000;
      policy.updateMetrics(metricReport);
      let preferences: VideoPreference[] = [];
      preferences.push(new VideoPreference('attendee-3', 1));
      policy.chooseRemoteVideoSources(preferences);
      let resub = policy.wantsResubscribe();
      expect(resub).to.equal(true);
      let received = policy.chooseSubscriptions();
      expect(received.array()).to.deep.equal([6]);

      incrementTime(6100);
      policy.chooseRemoteVideoSources(preferences);
      resub = policy.wantsResubscribe();
      expect(resub).to.equal(false);

      preferences = [];
      preferences.push(new VideoPreference('attendee-2', 1));
      policy.chooseRemoteVideoSources(preferences);
      resub = policy.wantsResubscribe();
      expect(resub).to.equal(true);
      received = policy.chooseSubscriptions();
      expect(received.array()).to.deep.equal([4]);
    });
  });

  describe('probing', () => {
    it('Probe success during priority preference', () => {
      updateIndexFrame(videoStreamIndex, 2, 300, 1200);
      policy.updateIndex(videoStreamIndex);
      const metricReport = new DefaultClientMetricReport(logger);
      metricReport.globalMetricReport = new GlobalMetricReport();
      metricReport.globalMetricReport.currentMetrics['googAvailableReceiveBandwidth'] =
        10000 * 1000;
      let preferences: VideoPreference[] = [];
      preferences.push(new VideoPreference('attendee-2', 1));
      preferences.push(new VideoPreference('attendee-1', 2));
      policy.chooseRemoteVideoSources(preferences);
      let resub = policy.wantsResubscribe();
      expect(resub).to.equal(true);
      let received = policy.chooseSubscriptions();
      expect(received.array()).to.deep.equal([2, 4]);
      const tile1 = tileController.addVideoTile();
      tile1.stateRef().boundAttendeeId = 'attendee-1';
      const tile2 = tileController.addVideoTile();
      tile2.stateRef().boundAttendeeId = 'attendee-2';

      incrementTime(6100);
      preferences = [];
      preferences.push(new VideoPreference('attendee-2', 1));
      preferences.push(new VideoPreference('attendee-1', 1));
      policy.chooseRemoteVideoSources(preferences);
      metricReport.globalMetricReport.currentMetrics['googAvailableReceiveBandwidth'] = 9000 * 1000;
      policy.updateMetrics(metricReport);
      resub = policy.wantsResubscribe();
      expect(resub).to.equal(false);

      incrementTime(3000);
      preferences = [];
      preferences.push(new VideoPreference('attendee-2', 1));
      preferences.push(new VideoPreference('attendee-1', 2));
      policy.chooseRemoteVideoSources(preferences);
      metricReport.globalMetricReport.currentMetrics['googAvailableReceiveBandwidth'] = 1200 * 1000;
      setPacketLoss(metricReport, 42, 160);
      policy.updateMetrics(metricReport);
      resub = policy.wantsResubscribe();
      expect(resub).to.equal(false);
      expect(tile1.state().pausedDueToBandwidth).to.equal(true);

      incrementTime(3000);
      metricReport.globalMetricReport.currentMetrics['googAvailableReceiveBandwidth'] = 700 * 1000;
      setPacketLoss(metricReport, 30, 20);
      policy.updateMetrics(metricReport);
      resub = policy.wantsResubscribe();
      expect(resub).to.equal(true);
      received = policy.chooseSubscriptions();
      expect(received.array()).to.deep.equal([2, 3]);
      expect(tile1.state().pausedDueToBandwidth).to.equal(true);

      incrementTime(2000);
      metricReport.globalMetricReport.currentMetrics['googAvailableReceiveBandwidth'] = 600 * 1000;
      setPacketLoss(metricReport, 0, 0);
      policy.updateMetrics(metricReport);
      resub = policy.wantsResubscribe();
      expect(resub).to.equal(false);

      // Probe
      incrementTime(7000);
      metricReport.globalMetricReport.currentMetrics['googAvailableReceiveBandwidth'] = 600 * 1000;
      policy.updateMetrics(metricReport);
      resub = policy.wantsResubscribe();
      expect(resub).to.equal(true);
      received = policy.chooseSubscriptions();
      expect(received.array()).to.deep.equal([2, 4]);
      expect(tile1.state().pausedDueToBandwidth).to.equal(true);

      incrementTime(2000);
      metricReport.globalMetricReport.currentMetrics['googAvailableReceiveBandwidth'] = 700 * 1000;
      setPacketLoss(metricReport, 0, 0);
      policy.updateMetrics(metricReport);
      resub = policy.wantsResubscribe();
      expect(resub).to.equal(false);

      incrementTime(2000);
      metricReport.globalMetricReport.currentMetrics['googAvailableReceiveBandwidth'] = 1100 * 1000;
      setPacketLoss(metricReport, 0, 0);
      policy.updateMetrics(metricReport);
      const bitrates = updateBitrateFrame(2, 200, 1100);
      videoStreamIndex.integrateBitratesFrame(bitrates);
      policy.updateIndex(videoStreamIndex);
      resub = policy.wantsResubscribe();
      expect(resub).to.equal(false);

      // Probe success
      incrementTime(2000);
      metricReport.globalMetricReport.currentMetrics['googAvailableReceiveBandwidth'] = 1300 * 1000;
      setPacketLoss(metricReport, 0, 0);
      policy.updateMetrics(metricReport);
      resub = policy.wantsResubscribe();
      expect(resub).to.equal(false);

      incrementTime(6000);
      metricReport.globalMetricReport.currentMetrics['googAvailableReceiveBandwidth'] = 2700 * 1000;
      setPacketLoss(metricReport, 0, 0);
      policy.updateMetrics(metricReport);
      resub = policy.wantsResubscribe();
      expect(resub).to.equal(false);
      expect(tile1.state().pausedDueToBandwidth).to.equal(false);
    });

    it('Probe fail', () => {
      updateIndexFrame(videoStreamIndex, 4, 300, 1200);
      policy.updateIndex(videoStreamIndex);
      const preferences: VideoPreference[] = [];
      preferences.push(new VideoPreference('attendee-1', 2));
      preferences.push(new VideoPreference('attendee-2', 2));
      preferences.push(new VideoPreference('attendee-3', 2));
      preferences.push(new VideoPreference('attendee-4', 2));
      policy.chooseRemoteVideoSources(preferences);
      let resub = policy.wantsResubscribe();
      expect(resub).to.equal(true);
      let received = policy.chooseSubscriptions();
      expect(received.array()).to.deep.equal([2, 3, 5, 7]);
      const tile1 = tileController.addVideoTile();
      tile1.stateRef().boundAttendeeId = 'attendee-1';
      const tile2 = tileController.addVideoTile();
      tile2.stateRef().boundAttendeeId = 'attendee-2';
      const tile3 = tileController.addVideoTile();
      tile3.stateRef().boundAttendeeId = 'attendee-3';
      const tile4 = tileController.addVideoTile();
      tile4.stateRef().boundAttendeeId = 'attendee-4';

      incrementTime(6100);
      const metricReport = new DefaultClientMetricReport(logger);
      metricReport.globalMetricReport = new GlobalMetricReport();
      metricReport.globalMetricReport.currentMetrics['googAvailableReceiveBandwidth'] = 2100 * 1000;
      policy.updateMetrics(metricReport);
      resub = policy.wantsResubscribe();
      expect(resub).to.equal(false);

      incrementTime(2000);
      metricReport.globalMetricReport.currentMetrics['googAvailableReceiveBandwidth'] = 2822 * 1000;
      policy.updateMetrics(metricReport);
      resub = policy.wantsResubscribe();
      expect(resub).to.equal(false);

      incrementTime(3000);
      metricReport.globalMetricReport.currentMetrics['googAvailableReceiveBandwidth'] = 3900 * 1000;
      policy.updateMetrics(metricReport);
      resub = policy.wantsResubscribe();
      expect(resub).to.equal(true);
      received = policy.chooseSubscriptions();
      expect(received.array()).to.deep.equal([2, 4, 6, 7]);

      incrementTime(2000);
      metricReport.globalMetricReport.currentMetrics['googAvailableReceiveBandwidth'] = 3900 * 1000;
      policy.updateMetrics(metricReport);
      resub = policy.wantsResubscribe();
      expect(resub).to.equal(false);

      // Start Probe
      incrementTime(6000);
      metricReport.globalMetricReport.currentMetrics['googAvailableReceiveBandwidth'] = 3900 * 1000;
      policy.updateMetrics(metricReport);
      resub = policy.wantsResubscribe();
      expect(resub).to.equal(true);
      received = policy.chooseSubscriptions();
      expect(received.array()).to.deep.equal([2, 4, 6, 8]);

      // Probe fail
      incrementTime(5000);
      metricReport.globalMetricReport.currentMetrics['googAvailableReceiveBandwidth'] = 465 * 1000;
      setPacketLoss(metricReport, 30, 20);
      policy.updateMetrics(metricReport);
      resub = policy.wantsResubscribe();
      expect(resub).to.equal(true);
      received = policy.chooseSubscriptions();
      expect(received.array()).to.deep.equal([2, 4, 6, 7]);

      incrementTime(2000);
      metricReport.globalMetricReport.currentMetrics['googAvailableReceiveBandwidth'] = 405 * 1000;
      setPacketLoss(metricReport, 40, 30);
      policy.updateMetrics(metricReport);
      resub = policy.wantsResubscribe();
      expect(resub).to.equal(false);

      incrementTime(2000);
      metricReport.globalMetricReport.currentMetrics['googAvailableReceiveBandwidth'] = 405 * 1000;
      setPacketLoss(metricReport, 50, 40);
      policy.updateMetrics(metricReport);
      resub = policy.wantsResubscribe();
      expect(resub).to.equal(false);

      incrementTime(3000);
      metricReport.globalMetricReport.currentMetrics['googAvailableReceiveBandwidth'] = 405 * 1000;
      setPacketLoss(metricReport, 60, 50);
      policy.updateMetrics(metricReport);
      resub = policy.wantsResubscribe();
      expect(resub).to.equal(true);
      received = policy.chooseSubscriptions();
      expect(received.array()).to.deep.equal([1, 4, 6, 7]);
      expect(tile2.state().pausedDueToBandwidth).to.equal(true);
      expect(tile3.state().pausedDueToBandwidth).to.equal(true);
      expect(tile4.state().pausedDueToBandwidth).to.equal(true);
    });
  });

  describe('pausedDueToBandwidth', () => {
    it('Tile added but not in subscribe', () => {
      updateIndexFrame(videoStreamIndex, 2, 300, 1200);
      policy.updateIndex(videoStreamIndex);
      const metricReport = new DefaultClientMetricReport(logger);
      metricReport.globalMetricReport = new GlobalMetricReport();
      metricReport.globalMetricReport.currentMetrics['googAvailableReceiveBandwidth'] =
        10000 * 1000;
      const preferences: VideoPreference[] = [];
      preferences.push(new VideoPreference('attendee-2', 1));
      preferences.push(new VideoPreference('attendee-1', 2));
      policy.chooseRemoteVideoSources(preferences);
      let resub = policy.wantsResubscribe();
      expect(resub).to.equal(true);
      let received = policy.chooseSubscriptions();
      expect(received.array()).to.deep.equal([2, 4]);
      const tile1 = tileController.addVideoTile();
      tile1.stateRef().boundAttendeeId = 'attendee-1';
      const tile2 = tileController.addVideoTile();
      tile2.stateRef().boundAttendeeId = 'attendee-2';

      incrementTime(6100);
      metricReport.globalMetricReport.currentMetrics['googAvailableReceiveBandwidth'] = 3000 * 1000;
      policy.updateMetrics(metricReport);
      resub = policy.wantsResubscribe();
      expect(resub).to.equal(false);

      incrementTime(3000);
      metricReport.globalMetricReport.currentMetrics['googAvailableReceiveBandwidth'] = 3000 * 1000;
      policy.updateMetrics(metricReport);
      resub = policy.wantsResubscribe();
      expect(resub).to.equal(false);

      incrementTime(3000);
      updateIndexFrame(videoStreamIndex, 3, 300, 1200);
      policy.updateIndex(videoStreamIndex);
      metricReport.globalMetricReport.currentMetrics['googAvailableReceiveBandwidth'] = 2400 * 1000;
      setPacketLoss(metricReport, 30, 20);
      policy.updateMetrics(metricReport);
      resub = policy.wantsResubscribe();
      expect(resub).to.equal(false);
      preferences.push(new VideoPreference('attendee-3', 3));
      policy.chooseRemoteVideoSources(preferences);
      resub = policy.wantsResubscribe();
      expect(resub).to.equal(false);
      const tiles = tileController.getAllRemoteVideoTiles();
      for (const tile of tiles) {
        const state = tile.state();
        if (state.boundAttendeeId === 'attendee-3') {
          expect(state.pausedDueToBandwidth).to.equal(true);
        } else {
          expect(state.pausedDueToBandwidth).to.equal(false);
        }
      }

      incrementTime(3000);
      metricReport.globalMetricReport.currentMetrics['googAvailableReceiveBandwidth'] = 2400 * 1000;
      setPacketLoss(metricReport, 0, 0);
      policy.updateMetrics(metricReport);
      resub = policy.wantsResubscribe();
      expect(resub).to.equal(false);

      metricReport.globalMetricReport.currentMetrics['googAvailableReceiveBandwidth'] = 3000 * 1000;
      setPacketLoss(metricReport, 0, 0);
      policy.updateMetrics(metricReport);
      resub = policy.wantsResubscribe();
      expect(resub).to.equal(true);
      received = policy.chooseSubscriptions();
      expect(received.array()).to.deep.equal([2, 4, 5]);
      for (const tile of tiles) {
        const state = tile.state();
        expect(state.pausedDueToBandwidth).to.equal(false);
      }
    });

    it('Stream not added until enough bandwidth', () => {
      updateIndexFrame(videoStreamIndex, 3, 300, 1200);
      policy.updateIndex(videoStreamIndex);
      const metricReport = new DefaultClientMetricReport(logger);
      metricReport.globalMetricReport = new GlobalMetricReport();
      metricReport.globalMetricReport.currentMetrics['googAvailableReceiveBandwidth'] =
        10000 * 1000;
      const preferences: VideoPreference[] = [];
      preferences.push(new VideoPreference('attendee-1', 2));
      preferences.push(new VideoPreference('attendee-2', 2));
      preferences.push(new VideoPreference('attendee-3', 2));
      policy.chooseRemoteVideoSources(preferences);
      let resub = policy.wantsResubscribe();
      expect(resub).to.equal(true);
      let received = policy.chooseSubscriptions();
      expect(received.array()).to.deep.equal([2, 4, 5]);
      const tile1 = tileController.addVideoTile();
      tile1.stateRef().boundAttendeeId = 'attendee-1';
      const tile2 = tileController.addVideoTile();
      tile2.stateRef().boundAttendeeId = 'attendee-2';
      const tile3 = tileController.addVideoTile();
      tile3.stateRef().boundAttendeeId = 'attendee-3';

      incrementTime(6100);
      metricReport.globalMetricReport.currentMetrics['googAvailableReceiveBandwidth'] = 3000 * 1000;
      policy.updateMetrics(metricReport);
      resub = policy.wantsResubscribe();
      expect(resub).to.equal(false);

      incrementTime(3000);
      metricReport.globalMetricReport.currentMetrics['googAvailableReceiveBandwidth'] = 3000 * 1000;
      policy.updateMetrics(metricReport);
      resub = policy.wantsResubscribe();
      expect(resub).to.equal(false);

      incrementTime(3000);
      metricReport.globalMetricReport.currentMetrics['googAvailableReceiveBandwidth'] = 3600 * 1000;
      policy.updateMetrics(metricReport);
      resub = policy.wantsResubscribe();
      expect(resub).to.equal(true);
      received = policy.chooseSubscriptions();
      expect(received.array()).to.deep.equal([2, 4, 6]);

      incrementTime(3000);
      metricReport.globalMetricReport.currentMetrics['googAvailableReceiveBandwidth'] = 900 * 1000;
      setPacketLoss(metricReport, 30, 20);
      policy.updateMetrics(metricReport);
      resub = policy.wantsResubscribe();
      expect(resub).to.equal(true);
      received = policy.chooseSubscriptions();
      expect(received.array()).to.deep.equal([1, 3, 5]);

      incrementTime(3000);
      metricReport.globalMetricReport.currentMetrics['googAvailableReceiveBandwidth'] = 300 * 1000;
      setPacketLoss(metricReport, 30, 20);
      policy.updateMetrics(metricReport);
      resub = policy.wantsResubscribe();
      expect(resub).to.equal(false);
      expect(tile2.state().pausedDueToBandwidth).to.equal(true);
      expect(tile3.state().pausedDueToBandwidth).to.equal(true);

      incrementTime(3000);
      updateIndexFrame(videoStreamIndex, 4, 300, 1200);
      policy.updateIndex(videoStreamIndex);
      metricReport.globalMetricReport.currentMetrics['googAvailableReceiveBandwidth'] = 300 * 1000;
      setPacketLoss(metricReport, 30, 20);
      policy.updateMetrics(metricReport);
      resub = policy.wantsResubscribe();
      expect(resub).to.equal(false);
      preferences.push(new VideoPreference('attendee-4', 2));
      policy.chooseRemoteVideoSources(preferences);
      resub = policy.wantsResubscribe();
      expect(resub).to.equal(false);
      let tiles = tileController.getAllRemoteVideoTiles();
      for (const tile of tiles) {
        const state = tile.state();
        if (state.boundAttendeeId === 'attendee-1') {
          expect(state.pausedDueToBandwidth).to.equal(false);
        } else {
          expect(state.pausedDueToBandwidth).to.equal(true);
        }
      }
      received = policy.chooseSubscriptions();
      expect(received.array()).to.deep.equal([1, 3, 5]);

      incrementTime(3000);
      metricReport.globalMetricReport.currentMetrics['googAvailableReceiveBandwidth'] = 600 * 1000;
      setPacketLoss(metricReport, 0, 0);
      policy.updateMetrics(metricReport);
      resub = policy.wantsResubscribe();
      expect(resub).to.equal(false);
      tiles = tileController.getAllRemoteVideoTiles();
      for (const tile of tiles) {
        const state = tile.state();
        if (state.boundAttendeeId === 'attendee-1' || state.boundAttendeeId === 'attendee-2') {
          expect(state.pausedDueToBandwidth).to.equal(false);
        } else {
          expect(state.pausedDueToBandwidth).to.equal(true);
        }
      }

      incrementTime(3000);
      metricReport.globalMetricReport.currentMetrics['googAvailableReceiveBandwidth'] = 1200 * 1000;
      setPacketLoss(metricReport, 0, 0);
      policy.updateMetrics(metricReport);
      resub = policy.wantsResubscribe();
      expect(resub).to.equal(true);
      received = policy.chooseSubscriptions();
      expect(received.array()).to.deep.equal([1, 3, 5, 7]);
      tiles = tileController.getAllRemoteVideoTiles();
      for (const tile of tiles) {
        const state = tile.state();
        expect(state.pausedDueToBandwidth).to.equal(false);
      }
    });
  });

  describe('minimizeThrashing', () => {
    it('dont change subscription with small change', () => {
      updateIndexFrame(videoStreamIndex, 4, 300, 1200);
      policy.updateIndex(videoStreamIndex);
      const metricReport = new DefaultClientMetricReport(logger);
      metricReport.globalMetricReport = new GlobalMetricReport();
      metricReport.globalMetricReport.currentMetrics['googAvailableReceiveBandwidth'] =
        10000 * 1000;
      const preferences: VideoPreference[] = [];
      preferences.push(new VideoPreference('attendee-1', 1));
      preferences.push(new VideoPreference('attendee-2', 1));
      preferences.push(new VideoPreference('attendee-3', 1));
      preferences.push(new VideoPreference('attendee-4', 1));
      policy.chooseRemoteVideoSources(preferences);
      let resub = policy.wantsResubscribe();
      expect(resub).to.equal(true);
      const received = policy.chooseSubscriptions();
      expect(received.array()).to.deep.equal([2, 3, 5, 7]);

      incrementTime(6100);
      metricReport.globalMetricReport.currentMetrics['googAvailableReceiveBandwidth'] = 3000 * 1000;
      policy.updateMetrics(metricReport);
      resub = policy.wantsResubscribe();
      expect(resub).to.equal(false);

      incrementTime(3000);
      metricReport.globalMetricReport.currentMetrics['googAvailableReceiveBandwidth'] = 3000 * 1000;
      setPacketLoss(metricReport, 0, 0);
      policy.updateMetrics(metricReport);
      resub = policy.wantsResubscribe();
      expect(resub).to.equal(false);

      incrementTime(3000);
      metricReport.globalMetricReport.currentMetrics['googAvailableReceiveBandwidth'] = 3000 * 1000;
      setPacketLoss(metricReport, 0, 1);
      policy.updateMetrics(metricReport);
      resub = policy.wantsResubscribe();
      expect(resub).to.equal(false);

      incrementTime(2000);
      metricReport.globalMetricReport.currentMetrics['googAvailableReceiveBandwidth'] = 1100 * 1000;
      setPacketLoss(metricReport, 0, 0);
      policy.updateMetrics(metricReport);
      const bitrates = updateBitrateFrame(2, 200, 1100);
      videoStreamIndex.integrateBitratesFrame(bitrates);
      policy.updateIndex(videoStreamIndex);
      resub = policy.wantsResubscribe();
      expect(resub).to.equal(false);
    });
  });
});
