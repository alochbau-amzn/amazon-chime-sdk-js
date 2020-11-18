// Copyright 2020 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import * as chai from 'chai';

import ClientMetricReportDirection from '../../src/clientmetricreport/ClientMetricReportDirection';
import DefaultClientMetricReport from '../../src/clientmetricreport/DefaultClientMetricReport';
import GlobalMetricReport from '../../src/clientmetricreport/GlobalMetricReport';
import StreamMetricReport from '../../src/clientmetricreport/StreamMetricReport';
import ConsoleLogger from '../../src/logger/ConsoleLogger';
import LogLevel from '../../src/logger/LogLevel';
import {
  SdkIndexFrame,
  SdkStreamDescriptor,
  SdkStreamMediaType,
} from '../../src/signalingprotocol/SignalingProtocol';
import VideoPreference from '../../src/videodownlinkbandwidthpolicy/VideoPreference';
import VideoPriorityBasedPolicy from '../../src/videodownlinkbandwidthpolicy/VideoPriorityBasedPolicy';
import SimulcastVideoStreamIndex from '../../src/videostreamindex/SimulcastVideoStreamIndex';

describe('VideoPriorityBasedPolicy', () => {
  const expect: Chai.ExpectStatic = chai.expect;
  const assert: Chai.AssertStatic = chai.assert;
  const logger = new ConsoleLogger('sdk', LogLevel.INFO);
  let policy: VideoPriorityBasedPolicy;
  let videoStreamIndex: SimulcastVideoStreamIndex;
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
    policy = new VideoPriorityBasedPolicy(logger);
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
      const preferences: VideoPreference[] =[];
      preferences.push(new VideoPreference('attendee-1', 1));
      policy.setRemoteSourcePriority(preferences);
      let resub = policy.wantsResubscribe();
      expect(resub).to.equal(true);
      let received = policy.chooseSubscriptions();
      expect(received.array()).to.deep.equal([2]);
      policy.reset();
      received = policy.chooseSubscriptions();
      expect(received.array()).to.deep.equal([]);
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

        const preferences: VideoPreference[] =[];
        preferences.push(new VideoPreference('attendee-5', 1));
        policy.setRemoteSourcePriority(preferences);
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
        let preferences: VideoPreference[] =[];
        preferences.push(new VideoPreference('attendee-3', 1));
        policy.setRemoteSourcePriority(preferences);
        let resub = policy.wantsResubscribe();
        expect(resub).to.equal(true);
        let received = policy.chooseSubscriptions();
        expect(received.array()).to.deep.equal([6]);

        incrementTime(6100);
        metricReport.globalMetricReport.currentMetrics['googAvailableReceiveBandwidth'] = 2400 * 1000;
        policy.updateMetrics(metricReport);
        preferences = [];
        policy.setRemoteSourcePriority(preferences);
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
        let preferences: VideoPreference[] =[];
        preferences.push(new VideoPreference('attendee-3', 1));
        policy.setRemoteSourcePriority(preferences);
        let resub = policy.wantsResubscribe();
        expect(resub).to.equal(true);
        let received = policy.chooseSubscriptions();
        expect(received.array()).to.deep.equal([6]);

        incrementTime(6100);
        policy.setRemoteSourcePriority(preferences);
        resub = policy.wantsResubscribe();
        expect(resub).to.equal(false);

        preferences = [];
        preferences.push(new VideoPreference('attendee-2', 1));
        policy.setRemoteSourcePriority(preferences);
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
      metricReport.globalMetricReport.currentMetrics['googAvailableReceiveBandwidth'] = 10000 * 1000;
      let preferences: VideoPreference[] =[];
      preferences.push(new VideoPreference('attendee-2', 1));
      preferences.push(new VideoPreference('attendee-1', 2));
      policy.setRemoteSourcePriority(preferences);
      let resub = policy.wantsResubscribe();
      expect(resub).to.equal(true);
      let received = policy.chooseSubscriptions();
      expect(received.array()).to.deep.equal([2, 4]);

      incrementTime(6100);
      metricReport.globalMetricReport.currentMetrics['googAvailableReceiveBandwidth'] = 9000 * 1000;
      policy.updateMetrics(metricReport);
      resub = policy.wantsResubscribe();
      expect(resub).to.equal(false);

      resub = policy.wantsResubscribe();
      expect(resub).to.equal(false);

      incrementTime(3000);
      metricReport.globalMetricReport.currentMetrics['googAvailableReceiveBandwidth'] = 1200 * 1000;
      setPacketLoss(metricReport, 42, 160);
      policy.updateMetrics(metricReport);
      resub = policy.wantsResubscribe();
      expect(resub).to.equal(true);
      received = policy.chooseSubscriptions();
      expect(received.array()).to.deep.equal([4]);

      incrementTime(3000);
      metricReport.globalMetricReport.currentMetrics['googAvailableReceiveBandwidth'] = 700 * 1000;
      setPacketLoss(metricReport, 30, 20);
      policy.updateMetrics(metricReport);
      resub = policy.wantsResubscribe();
      expect(resub).to.equal(true);
      received = policy.chooseSubscriptions();
      expect(received.array()).to.deep.equal([3]);

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
      expect(received.array()).to.deep.equal([4]);

      incrementTime(2000);
      metricReport.globalMetricReport.currentMetrics['googAvailableReceiveBandwidth'] = 700 * 1000;
      setPacketLoss(metricReport, 0, 0);
      policy.updateMetrics(metricReport);
      resub = policy.wantsResubscribe();
      expect(resub).to.equal(false);

      // Probe success
      incrementTime(2000);;
      metricReport.globalMetricReport.currentMetrics['googAvailableReceiveBandwidth'] = 1300 * 1000;
      setPacketLoss(metricReport, 0, 0);
      policy.updateMetrics(metricReport);
      resub = policy.wantsResubscribe();
      expect(resub).to.equal(false);
    });
  });

});
