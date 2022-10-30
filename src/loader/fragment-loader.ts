import { ErrorDetails, ErrorTypes } from '../errors';
import type { BaseSegment, Part } from './fragment';
import { Fragment } from './fragment';
import {
  FragmentLoaderContext,
  Loader,
  LoaderConfiguration,
  PlaylistLevelType,
} from '../types/loader';
import type { HlsConfig } from '../config';
import type { FragLoadedData } from '../types/events';
import { logger } from '../utils/logger';

const MIN_CHUNK_SIZE = Math.pow(2, 17); // 128kb

export default class FragmentLoader {
  private readonly config: HlsConfig;
  private loader: Loader<FragmentLoaderContext> | null = null;
  private partLoadTimeout: number = -1;

  constructor(config: HlsConfig) {
    this.config = config;
  }

  destroy() {
    if (this.loader) {
      this.loader.destroy();
      this.loader = null;
    }
  }

  abort() {
    if (this.loader) {
      // Abort the loader for current fragment. Only one may load at any given time
      this.loader.abort();
    }
  }

  load(
    frag: Fragment,
    onProgress?: FragmentLoadProgressCallback
  ): Promise<FragLoadedData> {
    const url = frag.url;
    if (!url) {
      return Promise.reject(
        new LoadError(
          {
            type: ErrorTypes.NETWORK_ERROR,
            details: ErrorDetails.FRAG_LOAD_ERROR,
            fatal: false,
            frag,
            networkDetails: null,
          },
          `Fragment does not have a ${url ? 'part list' : 'url'}`
        )
      );
    }
    this.abort();

    if (frag.type == PlaylistLevelType.MAIN && frag.sn == -1) {
      frag.isFiller = true;
    }

    if (frag.isFiller) {
      return new Promise((resolve, reject) => {
        this.createFiller(
          frag,
          (initData: Uint8Array, fragData: Uint8Array) => {
            const url = Math.random().toString();
            frag.initSegment = new Fragment(PlaylistLevelType.MAIN, url);
            frag.initSegment.data = initData;

            onProgress?.({
              frag,
              part: null,
              payload: fragData.buffer,
              networkDetails: null,
            });

            resolve({
              frag,
              part: null,
              payload: fragData.buffer,
              networkDetails: null,
            });
          }
        );
      });
    }

    const config = this.config;
    const FragmentILoader = config.fLoader;
    const DefaultILoader = config.loader;

    return new Promise((resolve, reject) => {
      if (this.loader) {
        this.loader.destroy();
      }
      const loader =
        (this.loader =
        frag.loader =
          FragmentILoader
            ? new FragmentILoader(config)
            : (new DefaultILoader(config) as Loader<FragmentLoaderContext>));
      const loaderContext = createLoaderContext(frag);
      const loaderConfig: LoaderConfiguration = {
        timeout: config.fragLoadingTimeOut,
        maxRetry: 0,
        retryDelay: 0,
        maxRetryDelay: config.fragLoadingMaxRetryTimeout,
        highWaterMark: frag.sn === 'initSegment' ? Infinity : MIN_CHUNK_SIZE,
      };
      // Assign frag stats to the loader's stats reference
      frag.stats = loader.stats;
      loader.load(loaderContext, loaderConfig, {
        onSuccess: (response, stats, context, networkDetails) => {
          this.resetLoader(frag, loader);
          resolve({
            frag,
            part: null,
            payload: response.data as ArrayBuffer,
            networkDetails,
          });
        },
        onError: (response, context, networkDetails) => {
          this.resetLoader(frag, loader);
          reject(
            new LoadError({
              type: ErrorTypes.NETWORK_ERROR,
              details: ErrorDetails.FRAG_LOAD_ERROR,
              fatal: false,
              frag,
              response,
              networkDetails,
            })
          );
        },
        onAbort: (stats, context, networkDetails) => {
          this.resetLoader(frag, loader);
          reject(
            new LoadError({
              type: ErrorTypes.NETWORK_ERROR,
              details: ErrorDetails.INTERNAL_ABORTED,
              fatal: false,
              frag,
              networkDetails,
            })
          );
        },
        onTimeout: (response, context, networkDetails) => {
          this.resetLoader(frag, loader);
          reject(
            new LoadError({
              type: ErrorTypes.NETWORK_ERROR,
              details: ErrorDetails.FRAG_LOAD_TIMEOUT,
              fatal: false,
              frag,
              networkDetails,
            })
          );
        },
        onProgress: (stats, context, data, networkDetails) => {
          if (onProgress) {
            onProgress({
              frag,
              part: null,
              payload: data as ArrayBuffer,
              networkDetails,
            });
          }
        },
        onMustFill: () => {
          frag.isFiller = true;
          this.resetLoader(frag, loader);
          logger.info(`[fragment-loader] ${frag.sn} aborted with fill`);
          this.createFiller(
            frag,
            (initData: Uint8Array, fragData: Uint8Array) => {
              logger.info(`[fragment-loader] ${frag.sn} filler generated`);

              const url = Math.random().toString();
              frag.initSegment = new Fragment(PlaylistLevelType.MAIN, url);
              frag.initSegment.data = initData;

              onProgress?.({
                frag,
                part: null,
                payload: fragData.buffer,
                networkDetails: null,
              });

              resolve({
                frag,
                part: null,
                payload: fragData.buffer,
                networkDetails: null,
              });
            }
          );
        },
      });
    });
  }

  private createFiller(
    frag: Fragment,
    callback: (initData: Uint8Array, fragData: Uint8Array) => void
  ) {
    if (this.config.useStaticFiller) {
      const hex =
        '000000012764001eac5680a02ff9500000000128ee3cb00000000106051a47564adc5c4c433f94efc5113cd143a801ffccccff02002dc6c0800000000125b820027f7c81b05c30c7f81ea338d049c4f52e433b7efadf8ac0b210927f8f64e02800000300000300000301427f21fca1e81217570000030045801bc1320e10d80da12c1701fa358688ac000003000003000003000003000003000025e0';
      const byteArray = Uint8Array.from(
        hex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
      );

      const init: Uint8Array = createInit(byteArray);
      const seg: Uint8Array = createSegment(
        byteArray,
        frag.start,
        frag.duration
      );

      callback(init, seg);
      return;
    }

    const width = 640;
    const height = 360;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'blue';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const init = {
      output: async (chunk, metadata) => {
        const buffer = new ArrayBuffer(chunk.byteLength);
        chunk.copyTo(buffer);

        const byteArray = new Uint8Array(buffer);

        const init: Uint8Array = createInit(byteArray);
        const seg: Uint8Array = createSegment(
          byteArray,
          frag.start,
          frag.duration
        );

        callback(init, seg);
      },
      error: (e) => {
        logger.error(e);
      },
    };

    const config = {
      codec: 'avc1.64001f',
      width: width,
      height: height,
      bitrate: 3_000_000,
      framerate: 25,
      avc: { format: 'annexb' as AvcBitstreamFormat },
    };

    const encoder = new VideoEncoder(init);
    encoder.configure(config);

    const frameFromCanvas = new VideoFrame(canvas, {
      timestamp: frag.start,
    });

    encoder.encode(frameFromCanvas);
    frameFromCanvas.close();
  }

  public loadPart(
    frag: Fragment,
    part: Part,
    onProgress: FragmentLoadProgressCallback
  ): Promise<FragLoadedData> {
    this.abort();

    const config = this.config;
    const FragmentILoader = config.fLoader;
    const DefaultILoader = config.loader;

    return new Promise((resolve, reject) => {
      if (this.loader) {
        this.loader.destroy();
      }
      const loader =
        (this.loader =
        frag.loader =
          FragmentILoader
            ? new FragmentILoader(config)
            : (new DefaultILoader(config) as Loader<FragmentLoaderContext>));
      const loaderContext = createLoaderContext(frag, part);
      const loaderConfig: LoaderConfiguration = {
        timeout: config.fragLoadingTimeOut,
        maxRetry: 0,
        retryDelay: 0,
        maxRetryDelay: config.fragLoadingMaxRetryTimeout,
        highWaterMark: MIN_CHUNK_SIZE,
      };
      // Assign part stats to the loader's stats reference
      part.stats = loader.stats;
      loader.load(loaderContext, loaderConfig, {
        onSuccess: (response, stats, context, networkDetails) => {
          this.resetLoader(frag, loader);
          this.updateStatsFromPart(frag, part);
          const partLoadedData: FragLoadedData = {
            frag,
            part,
            payload: response.data as ArrayBuffer,
            networkDetails,
          };
          onProgress(partLoadedData);
          resolve(partLoadedData);
        },
        onError: (response, context, networkDetails) => {
          this.resetLoader(frag, loader);
          reject(
            new LoadError({
              type: ErrorTypes.NETWORK_ERROR,
              details: ErrorDetails.FRAG_LOAD_ERROR,
              fatal: false,
              frag,
              part,
              response,
              networkDetails,
            })
          );
        },
        onAbort: (stats, context, networkDetails) => {
          frag.stats.aborted = part.stats.aborted;
          this.resetLoader(frag, loader);
          reject(
            new LoadError({
              type: ErrorTypes.NETWORK_ERROR,
              details: ErrorDetails.INTERNAL_ABORTED,
              fatal: false,
              frag,
              part,
              networkDetails,
            })
          );
        },
        onTimeout: (response, context, networkDetails) => {
          this.resetLoader(frag, loader);
          reject(
            new LoadError({
              type: ErrorTypes.NETWORK_ERROR,
              details: ErrorDetails.FRAG_LOAD_TIMEOUT,
              fatal: false,
              frag,
              part,
              networkDetails,
            })
          );
        },
      });
    });
  }

  private updateStatsFromPart(frag: Fragment, part: Part) {
    const fragStats = frag.stats;
    const partStats = part.stats;
    const partTotal = partStats.total;
    fragStats.loaded += partStats.loaded;
    if (partTotal) {
      const estTotalParts = Math.round(frag.duration / part.duration);
      const estLoadedParts = Math.min(
        Math.round(fragStats.loaded / partTotal),
        estTotalParts
      );
      const estRemainingParts = estTotalParts - estLoadedParts;
      const estRemainingBytes =
        estRemainingParts * Math.round(fragStats.loaded / estLoadedParts);
      fragStats.total = fragStats.loaded + estRemainingBytes;
    } else {
      fragStats.total = Math.max(fragStats.loaded, fragStats.total);
    }
    const fragLoading = fragStats.loading;
    const partLoading = partStats.loading;
    if (fragLoading.start) {
      // add to fragment loader latency
      fragLoading.first += partLoading.first - partLoading.start;
    } else {
      fragLoading.start = partLoading.start;
      fragLoading.first = partLoading.first;
    }
    fragLoading.end = partLoading.end;
  }

  private resetLoader(frag: Fragment, loader: Loader<FragmentLoaderContext>) {
    frag.loader = null;
    if (this.loader === loader) {
      self.clearTimeout(this.partLoadTimeout);
      this.loader = null;
    }
    loader.destroy();
  }
}

function createLoaderContext(
  frag: Fragment,
  part: Part | null = null
): FragmentLoaderContext {
  const segment: BaseSegment = part || frag;
  const loaderContext: FragmentLoaderContext = {
    frag,
    part,
    responseType: 'arraybuffer',
    url: segment.url,
    headers: {},
    rangeStart: 0,
    rangeEnd: 0,
  };
  const start = segment.byteRangeStartOffset;
  const end = segment.byteRangeEndOffset;
  if (Number.isFinite(start) && Number.isFinite(end)) {
    loaderContext.rangeStart = start;
    loaderContext.rangeEnd = end;
  }
  return loaderContext;
}

export class LoadError extends Error {
  public readonly data: FragLoadFailResult;
  constructor(data: FragLoadFailResult, ...params) {
    super(...params);
    this.data = data;
  }
}

export interface FragLoadFailResult {
  type: string;
  details: string;
  fatal: boolean;
  frag: Fragment;
  part?: Part;
  response?: {
    // error status code
    code: number;
    // error description
    text: string;
  };
  networkDetails: any;
}

export type FragmentLoadProgressCallback = (result: FragLoadedData) => void;

declare function createInit(byteArray: Uint8Array): Uint8Array;

declare function createSegment(
  byteArray: Uint8Array,
  start: number,
  duration: number
): Uint8Array;
