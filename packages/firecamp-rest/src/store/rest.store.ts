import _cloneDeep from 'lodash/cloneDeep';
import create from 'zustand';
import createContext from 'zustand/context';
import { IRest, IRestResponse, TId } from '@firecamp/types';
import ScriptService from '../services/scripts/index';
import {
  prepareUIRequestPanelState,
  normalizeVariables,
  normalizeSendRequestPayload,
  initialiseStoreFromRequest,
} from '../services/request.service';
import {
  IRequestSlice,
  createRequestSlice,
  requestSliceKeys,
  createRuntimeSlice,
  IRuntime,
  IRuntimeSlice,
  createResponseSlice,
  IResponseSlice,
  createUiSlice,
  IUi,
  IUiSlice,
  IPullSlice,
  createPullActionSlice,
  IRequestChangeStateSlice,
  createRequestChangeStateSlice,
} from './index';
import { EFirecampAgent } from '@firecamp/types';
import { _object, _env, _array, _string } from '@firecamp/utils';
import { IRestClientRequest } from '../types';

const {
  Provider: RestStoreProvider,
  useStore: useRestStore,
  useStoreApi: useRestStoreApi,
} = createContext();

type TOnChangeVariables = ({
  workspace,
  collection,
}: {
  workspace: { [key: string]: any };
  collection?: { [key: string]: any };
}) => void;

interface IRestStore
  extends IRequestSlice,
    IRuntimeSlice,
    IResponseSlice,
    IUiSlice,
    IPullSlice,
    IRequestChangeStateSlice {
  originalRequest?: IRest;
  initialise: (request: IRest, tabId: TId) => void;
  context?: any;
  setContext: (ctx: any) => void;
  execute(
    variables: {
      merged: {};
      workspace: {};
      collection?: {};
    },
    fcAgent: EFirecampAgent,
    onChangeVariables: TOnChangeVariables
  ): void;
}

interface IRestStoreState {
  request?: IRestClientRequest;
  runtime?: IRuntime;
  response?: IRestResponse;
  ui?: IUi;
}

const createRestStore = (initialState: IRestStoreState) =>
  create<IRestStore>((set, get): IRestStore => {
    const uiRequestPanel = prepareUIRequestPanelState(initialState.request);
    return {
      initialise: (request: Partial<IRest>, tabId: TId) => {
        const state = get();
        const initState = initialiseStoreFromRequest(request, tabId);
        console.log(initState, 'initState');
        set((s) => ({
          ...s,
          ...initState,
          // @ts-ignore
          originalRequest: _cloneDeep(initState.request) as IRest,
        }));
        // update auth type, generate auth headers
        state.changeAuthType(request.auth?.type);
      },
      setContext: (ctx: any) => set({ context: ctx }),
      ...createRequestSlice(
        set,
        get,
        _object.pick(
          initialState.request,
          requestSliceKeys
        ) as IRestClientRequest
      ),
      ...createRuntimeSlice(set, get, initialState.runtime),
      ...createResponseSlice(set, get),
      ...createUiSlice(set, get, {
        ...initialState.ui,
        requestPanel: {
          ...initialState.ui.requestPanel,
          ...uiRequestPanel,
        },
      }),
      ...createPullActionSlice(set, get),
      ...createRequestChangeStateSlice(set, get),

      execute: async (
        variables: {
          merged: {};
          workspace: {};
          collection?: {};
        },
        fcAgent: EFirecampAgent,
        onChangeVariables: TOnChangeVariables
      ) => {
        try {
          // set response empty
          set({ response: { statusCode: 0 } });

          const state = get();
          let request: Omit<IRestClientRequest, 'auth'> = _cloneDeep(
            state.request
          ); //todo: discuss/review this type
          // console.log({ request, variables, fcAgent });

          // Check if request is running or not. stop running request if already true
          if (state.runtime.isRequestRunning === true) {
            await state.context.request.cancelExecution(
              request.__ref.id,
              fcAgent
            );
            // set request running state as false
            state.setRequestRunningFlag(false);
            return;
          }
          state.setRequestRunningFlag(true);
          
          let preScriptResponse: any = {};
          let postScriptResponse: any = {};
          let testScriptResponse: any = {};

          // run pre-script
          if (request?.scripts?.pre) {
            // TODO: add inherit support
            preScriptResponse = await ScriptService.runPreScript(
              state.request,
              variables.merged
            );
          }

          // TODO: history payload

          /* let certificates = [],
            proxies = []; */
          let updatedVariables: {
            workspace: {};
            collection?: {};
          } = {
            workspace: variables['workspace'],
            collection: variables['collection'],
          };

          // Merge script updated request with state request
          if (preScriptResponse?.request) {
            request = { ...state.request, ...preScriptResponse.request };
          }
          console.log({ preScriptResponse });

          // Normalize variables from pre script response and existing variables
          if (preScriptResponse.environment) {
            updatedVariables = await normalizeVariables(
              {
                workspace: variables['workspace'],
                collection: variables['collection'],
              },
              preScriptResponse.environment
            );
          }

          // console.log({ updatedVariables });

          // Parse variables
          request = _env.applyVariables(request, {
            ...updatedVariables.workspace,
            ...(updatedVariables.collection || {}),
          }) as Omit<IRestClientRequest, 'auth'>;

          // normalize request
          const normalizedRequest = await normalizeSendRequestPayload(
            request,
            state.request
          );

          console.log({ normalizedRequest, request });
          // execute request
          let response: IRestResponse = await state.context.request.execute(
            normalizedRequest
          );

          console.log({ response });

          // TODO: add cookies

          // run post-script
          if (request.scripts?.post) {
            // TODO: add inherit support
            postScriptResponse = await ScriptService.runPostScript(
              request.scripts?.post,
              response,
              {
                ...updatedVariables.workspace,
                ...(updatedVariables.collection || {}),
              }
            );
          }

          // merge post script response with actual response
          if (postScriptResponse?.response) {
            response = { ...response, ...postScriptResponse.response };
          }

          // console.log({ postScriptResponse });

          if (postScriptResponse.environment) {
            updatedVariables = await normalizeVariables(
              updatedVariables,
              postScriptResponse.environment
            );
          }

          // console.log({ updatedVariables });

          try {
            // run test-script
            // TODO: add inherit support
            testScriptResponse = await ScriptService.runTestScript(
              request,
              response,
              {
                ...updatedVariables.workspace,
                ...(updatedVariables.collection || {}),
              }
            );

            if (testScriptResponse) {
              response['testScriptResult'] = testScriptResponse;
            }
          } catch (error) {}

          set((s) => ({ response })); // TODO: check what to set/ response or testScriptResponse
          // console.log({ testScriptResponse });
          get().setRequestRunningFlag(false);

          // variables to update
          onChangeVariables(updatedVariables);
        } catch (error) {
          get().setRequestRunningFlag(false);

          console.info({
            API: 'execute',
            error,
          });

          if (_object.isObject(error) && 'statusCode' in error) {
            set((s) => ({ response: error }));
          } else {
            if (_object.isObject(error) && 'message' in error) {
              set((s) => ({
                response: { error: error.message, statusCode: 0 },
              }));
            } else {
              set((s) => ({ response: { error, statusCode: 0 } }));
            }
          }
        }
      },
    };
  });

export {
  RestStoreProvider,
  useRestStore,
  createRestStore,
  useRestStoreApi,
  IRestStoreState,
  IRestStore,
};
