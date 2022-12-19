import { useEffect } from 'react';
import { Container, Row, RootContainer, Column } from '@firecamp/ui-kit';
import equal from 'deep-equal';
import _cloneDeep from 'lodash/cloneDeep';
import _cleanDeep from 'clean-deep';
import { _array, _object } from '@firecamp/utils';
import shallow from 'zustand/shallow';

import { initialiseStoreFromRequest } from '../services/reqeust.service';
import UrlBarContainer from './common/urlbar/UrlBarContainer';
import ConnectionPanel from './connection-panel/ConnectionPanel';
import SidebarPanel from './sidebar-panel/SidebarPanel';
import '../sass/ws.sass';

// store
import {
  createWebsocketStore,
  useWebsocketStore,
  useWebsocketStoreApi,
  WebsocketStoreProvider,
  IWebsocketStore,
} from '../store/index';

const WebSocket = ({ tab, platformContext, activeTab, platformComponents }) => {
  const websocketStoreApi: any = useWebsocketStoreApi();
  const {
    setRequestSavedFlag,
    setIsFetchingReqFlag,
    initialise,
    initialiseCollection,
    setActiveEnvironments,
  } = useWebsocketStore(
    (s: IWebsocketStore) => ({
      connect: s.connect,
      setRequestSavedFlag: s.setRequestSavedFlag,
      setIsFetchingReqFlag: s.setIsFetchingReqFlag,
      initialise: s.initialise,
      initialiseCollection: s.initialiseCollection,
      setActiveEnvironments: s.setActiveEnvironments,
    }),
    shallow
  );

  /** assign environments on tab load or when activeTab change **/
  useEffect(() => {
    if (activeTab === tab.id) {
      const state = websocketStoreApi.getState() as IWebsocketStore;
      // existing active environments in to runtime
      const {
        activeEnvironments: { workspace = '', collection = '' },
      } = state.runtime;

      // set active environments to platform
      if (!!workspace) {
        platformContext.environment.setActiveEnvironments({
          activeEnvironments: {
            workspace,
            collection,
          },
          collectionId: tab?.request?.__ref?.collectionId || '',
        });
      }

      // subscribe environment updates
      platformContext.environment.subscribeChanges(
        tab.id,
        handlePlatformEnvironmentChanges
      );
    }
  }, [activeTab]);

  useEffect(() => {
    setRequestSavedFlag(tab?.__meta?.isSaved);
  }, [tab?.__meta?.isSaved]);

  /** subscribe/ unsubscribe request changes (pull-actions) */
  useEffect(() => {
    // subscribe request updates
    if (tab.__meta.isSaved && tab.request?.__ref?.id) {
      platformContext.request.subscribeChanges(
        tab.request.__ref.id,
        handlePull
      );
    }

    // unsubscribe request updates
    return () => {
      if (tab.__meta.isSaved && tab.request?.__ref?.id) {
        platformContext.request.unsubscribeChanges(tab.request.__ref.id);
      }
    };
  }, []);

  /** fetch request */
  useEffect(() => {
    const _fetchRequest = async () => {
      try {
        const isRequestSaved = !!tab?.request?.__ref?.id || false;
        // prepare a minimal request payload
        let _request = { collection: { folders: [], items: [] } }; // initialise will normalize the reuqest to prepare minimal request for tab

        if (isRequestSaved === true) {
          setIsFetchingReqFlag(true);
          try {
            const response = await platformContext.request.onFetch(
              tab.request.__ref.id
            );
            _request = { ...response.data };
          } catch (error) {
            console.error({
              api: 'fetch rest request',
              error,
            });
            throw error;
          }
        }
        const { collection, ...request } = _request;
        /** initialise ws store on tab load */
        initialise(request, tab.id);
        if (collection && !_object.isEmpty(collection))
          initialiseCollection(collection);
        setIsFetchingReqFlag(false);
      } catch (e) {
        console.error(e);
      }
    };
    _fetchRequest();
  }, []);

  const handlePull = () => {};

  // handle updates for environments from platform
  const handlePlatformEnvironmentChanges = (platformActiveEnvironments) => {
    // console.log({ platformActiveEnvironments });
    if (!platformActiveEnvironments) return;
    const state = websocketStoreApi.getState() as IWebsocketStore;
    const { activeEnvironments } = state.runtime;

    if (
      platformActiveEnvironments.workspace &&
      !equal(platformActiveEnvironments, activeEnvironments)
    ) {
      setActiveEnvironments(platformActiveEnvironments);
    }
  };

  const onSave = (pushPayload: any, tabId) => {
    console.log({ pushPayload });
    if (!pushPayload._action || !pushPayload.__ref.id) return;
    if (pushPayload._action.type === 'i') {
      platformContext.request.subscribeChanges(
        pushPayload.__ref.id,
        handlePull
      );
    }
    platformContext.request.onSave(pushPayload, tabId);
  };

  // if(isFetchingRequest === true) return <Loader />;
  console.log(tab, 'tab...');
  return (
    <RootContainer className="h-full w-full">
      <Container className="h-full with-divider">
        <UrlBarContainer
          tab={tab}
          collectionId={tab?.request?.__ref?.collectionId || ''}
          postComponents={platformComponents}
          onSaveRequest={onSave}
          platformContext={platformContext}
          // onPasteCurl={onPasteCurl}
        />
        <Container.Body>
          <Row flex={1} overflow="auto" className="with-divider h-full">
            <SidebarPanel />
            <Column>
              <ConnectionPanel />
            </Column>
          </Row>
        </Container.Body>
      </Container>
    </RootContainer>
  );
};

const withStore = (WrappedComponent) => {
  const MyComponent = ({ tab, ...props }) => {
    const { request = {}, id } = tab;
    const initState = initialiseStoreFromRequest(request, id);
    return (
      <WebsocketStoreProvider
        createStore={() => createWebsocketStore(initState)}
      >
        <WrappedComponent tab={tab} {...props} />
      </WebsocketStoreProvider>
    );
  };

  return MyComponent;
};

export default withStore(WebSocket);
