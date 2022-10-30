//go:build js && wasm

package main

import (
	"syscall/js"
)

func main() {
	done := make(chan struct{}, 0)
	global := js.Global()
	global.Set("createInit", js.FuncOf(jsCreateInit))
	global.Set("createSegment", js.FuncOf(jsCreateSegment))
	<-done
}

func jsCreateInit(this js.Value, args []js.Value) interface{} {
	bitstream := make([]uint8, args[0].Get("byteLength").Int())
	js.CopyBytesToGo(bitstream, args[0])

	data, err := CreateInit(bitstream)

	if err != nil {
		return err.Error()
	} else {
		dst := js.Global().Get("Uint8Array").New(len(data))
		js.CopyBytesToJS(dst, data)
		return dst
	}
}

func jsCreateSegment(this js.Value, args []js.Value) interface{} {
	bitstream := make([]uint8, args[0].Get("byteLength").Int())
	js.CopyBytesToGo(bitstream, args[0])

	timestamp := args[1].Int()
	duration := args[2].Int()

	data, err := CreateSegment(bitstream, timestamp, duration)

	if err != nil {
		return err.Error()
	} else {
		dst := js.Global().Get("Uint8Array").New(len(data))
		js.CopyBytesToJS(dst, data)
		return dst
	}
}
