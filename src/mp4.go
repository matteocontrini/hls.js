package main

import (
	"bytes"
	"github.com/edgeware/mp4ff/avc"
	"github.com/edgeware/mp4ff/mp4"
)

const TimeScale = 12800

func ExtractSpsPps(bitstream []byte) ([]byte, []byte) {
	nalus := avc.ExtractNalusFromByteStream(bitstream)
	var sps []byte
	var pps []byte
	for _, nalu := range nalus {
		switch avc.GetNaluType(nalu[0]) {
		case avc.NALU_SPS:
			sps = nalu
		case avc.NALU_PPS:
			pps = nalu
		}
	}
	return sps, pps
}

func CreateInit(bitstream []byte) ([]byte, error) {
	sps, pps := ExtractSpsPps(bitstream)
	spsNalus := [][]byte{sps}
	ppsNalus := [][]byte{pps}

	videoTimescale := uint32(TimeScale)
	init := mp4.CreateEmptyInit()
	init.AddEmptyTrack(videoTimescale, "video", "und")
	trak := init.Moov.Trak
	err := trak.SetAVCDescriptor("avc1", spsNalus, ppsNalus, true)
	if err != nil {
		return nil, err
	}

	var buf bytes.Buffer
	if err := init.Encode(&buf); err != nil {
		return nil, err
	}

	return buf.Bytes(), nil
}

func CreateSegment(bitstream []byte, timestamp int, duration int) ([]byte, error) {
	seg := mp4.NewMediaSegment()

	frag, err := mp4.CreateFragment(uint32(1), mp4.DefaultTrakID)
	if err != nil {
		return nil, err
	}

	seg.AddFragment(frag)

	bitstream = avc.ConvertByteStreamToNaluSample(bitstream)

	//for i := 0; i < 50; i++ {
	//	sample := mp4.FullSample{
	//		Sample: mp4.Sample{
	//			Flags:                 mp4.SyncSampleFlags,
	//			Dur:                   512,
	//			Size:                  uint32(len(bitstream)),
	//			CompositionTimeOffset: 0,
	//		},
	//		DecodeTime: uint64(512 * i),
	//		Data:       bitstream,
	//	}
	//
	//	frag.AddFullSample(sample)
	//}

	sample := mp4.FullSample{
		Sample: mp4.Sample{
			Flags:                 mp4.SyncSampleFlags,
			Dur:                   uint32(TimeScale * duration),
			Size:                  uint32(len(bitstream)),
			CompositionTimeOffset: 0,
		},
		DecodeTime: uint64(TimeScale * timestamp),
		Data:       bitstream,
	}

	frag.AddFullSample(sample)

	var buf bytes.Buffer
	if err := seg.Encode(&buf); err != nil {
		return nil, err
	}

	return buf.Bytes(), nil
}
