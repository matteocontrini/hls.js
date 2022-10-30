package main

import (
	"encoding/hex"
	"github.com/stretchr/testify/require"
	"os"
	"testing"
)

func TestInit(t *testing.T) {
	raw := "000000012764001fac56805005b90000000128ee3cb00000000106051a47564adc5c4c433f94efc5113cd143a801ffccccff02003567e0800000000125b82004ffd287aa907f3ff848a7fd12b610477f44d03bbacf90000003000003000003000006654d62d139d678d6b800000300000d90002660007b000192000710001fc00099000434001f6000c500075800000300000300000300000300000300000300000300000300000300000300000300000300000300000300000300000300000300000300000300000300000300000300000300000300000300000300000300000300000300000300000300000300000300000300000300000300000300000300000300000300001b30"
	rawBytes, err := hex.DecodeString(raw)
	require.NoError(t, err)

	init, err := CreateInit(rawBytes)

	require.NoError(t, err)

	os.WriteFile("init.mp4", init, 0644)
}

func TestSegment(t *testing.T) {
	raw := "000000012764001fac56805005b90000000128ee3cb00000000106051a47564adc5c4c433f94efc5113cd143a801ffccccff02003567e0800000000125b82004ffd287a78d9d5ff84730cb426d07b0de9669fad841dee237885d850200000300000300000300000301cbb63a702c89875c449880000003000018c000410000b10002a0000ae0003f800132000868003ec0018a000eb000000300000300000300000300000300000300000300000300000300000300000300000300000300000300000300000300000300000300000300000300000300000300000300000300000300000300000300000300000300000300000300000300000300000300000300000300000300000300000300000300003660"
	rawBytes, err := hex.DecodeString(raw)
	require.NoError(t, err)

	seg, err := CreateSegment(rawBytes)

	require.NoError(t, err)

	os.WriteFile("seg.mp4", seg, 0644)
}
