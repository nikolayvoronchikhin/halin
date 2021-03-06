import React, { Component } from 'react';
import sentry from './sentry/index';
import {
  GraphAppBase,
  CONNECTED
} from 'graph-app-kit/components/GraphAppBase';
import { Render } from 'graph-app-kit/components/Render';
import Neo4jConfiguration from './configuration/Neo4jConfiguration';
import PerformancePane from './performance/PerformancePane';
import OSPane from './performance/OSPane';
import DatabasePane from './db/DatabasePane';
import PermissionsPane from './configuration/PermissionsPane';
import ClusterOverviewPane from './overview/ClusterOverviewPane';
import ClusterNodeTabHeader from './ClusterNodeTabHeader';
import { Tab, Button } from 'semantic-ui-react'
import DiagnosticPane from './diagnostic/DiagnosticPane';
import Spinner from './Spinner';
import status from './status/index';
import AppFooter from './AppFooter';
import './App.css';
import 'semantic-ui-css/semantic.min.css';
import HalinContext from './data/HalinContext';
import Neo4jDesktopStandIn from './neo4jDesktop/Neo4jDesktopStandIn';
import uuid from 'uuid';
import _ from 'lodash';
import Troubleshooting from './neo4jDesktop/Troubleshooting';
import neo4j from './driver';

class Halin extends Component {
  state = {
    cTag: 1,
    halin: null,
    initPromise: null,
    error: null,
    panes: (driver = null, node = null, key = uuid.v4()) => ([
      // Because panes get reused across cluster nodes, we have to 
      // give them all a unique key so that as we recreate panes, we're passing down
      // different props that get separately constructed, and not reusing the same
      // objects.  
      // https://stackoverflow.com/questions/29074690/react-why-components-constructor-is-called-only-once
      {
        menuItem: 'Performance',
        render: () => this.paneWrapper(
          <PerformancePane key={key} node={node} driver={driver} />),
      },
      {
        menuItem: 'Configuration',
        render: () => this.paneWrapper(
          <Neo4jConfiguration key={key} node={node} driver={driver} />),
      },
      {
        menuItem: 'OS',
        render: () => this.paneWrapper(
          <OSPane key={key} node={node} driver={driver} />),
      },
      {
        menuItem: 'Data',
        render: () => this.paneWrapper(
          <DatabasePane key={key} node={node} driver={driver} />),
      },
    ]),
  };

  paneWrapper = (obj, cls = 'secondary') =>
    <Tab.Pane>
      <div className={`PaneWrapper ${cls}`}>{obj}</div>
    </Tab.Pane>;

  componentDidMount() {
    try {
      window.halinContext = new HalinContext();

      const initPromise = window.halinContext.initialize()
        .catch(err => {
          sentry.reportError(err, 'Error initializing halin context');
          this.setState({ error: err });
          return window.halinContext;
        })
        .then(ctx => {
          this.setState({ halin: ctx });
        });

      this.setState({ initPromise });
    } catch (e) {
      sentry.error(e);
    }
  }

  componentWillUnmount() {
    window.halinContext.shutdown();
  }

  renderCluster() {
    const nodePanes = this.state.halin.clusterNodes.map((node, key) => ({
      menuItem: {
        key: `node-${key}`,
        content: <ClusterNodeTabHeader key={key} node={node}/>,
      },
      render: () =>
        this.paneWrapper(
          this.renderSingleNode(this.state.halin.driverFor(node.getBoltAddress()), node),
          'primary'),
    }));

    const userMgmtPane = {
      menuItem: { key: 'User Management', content: 'User Management', icon: 'user' },
      render: () => {
        const node = this.state.halin.clusterNodes[0];
        const driver = this.state.halin.driverFor(node.getBoltAddress());

        return this.paneWrapper(
          <PermissionsPane node={node} driver={driver} />,
          'primary'
        );
      },
    };

    const diagnosticPane = {
      menuItem: { key: 'Diagnostics', content: 'Diagnostics', icon: 'cogs' },
      render: () => {
        const node = this.state.halin.clusterNodes[0];
        const driver = this.state.halin.driverFor(node.getBoltAddress());

        return this.paneWrapper(
          <DiagnosticPane
            node={node}
            driver={driver} />,
          'primary'
        );
      },
    };

    const overviewPane = {
      menuItem: {
        key: 'overview', 
        content: 'Overview',
      },
      render: () => this.paneWrapper(<ClusterOverviewPane />, 'primary'),
    };

    const allPanesInOrder = [overviewPane].concat(nodePanes);

    if (window.halinContext.supportsAuth() && window.halinContext.supportsNativeAuth()) {
      allPanesInOrder.push(userMgmtPane);
    }
    allPanesInOrder.push(diagnosticPane);

    return <Tab panes={allPanesInOrder} />;
  }

  renderSingleNode(driver = null, node = null) {
    return <Tab menu={{ secondary: true, pointing: true }} panes={this.state.panes(driver, node)} />;
  }

  render() {
    const err = (this.state.error ? status.formatStatusMessage(this) : null);

    if (err) {
      return (        
        <div className='MainBodyError'>
          { err }

          <Troubleshooting error={this.state.error}/>

          <Button 
            basic 
            style={{
              display: 'block',
              marginLeft: 'auto',
              marginRight: 'auto',
            }}
            onClick={() => window.location.reload()}>
            <i className="icon refresh"/> Try Again
          </Button>
        </div>
      )
    }

    if (!this.state.halin) {
      return (
        <div className='App' key='app' style={{ marginTop: '50px' }}>
          <h2>Initializing Halin...</h2>

          <Spinner/>
        </div>
      );
    }

    return (
      <div className="App" key="app">
        <Render if={this.props.connected}>
          <div className='MainBody'>
            {err ? err : this.renderCluster()}
          </div>
        </Render>

        <AppFooter />
      </div>
    );
  }
}

const App = () => {
  sentry.init();
  
  // If this global is defined, we're running in desktop.  If it isn't, then we need
  // to use the shim object to convince the rest of the app we're in Desktop.
  const fakeDesktopApiNeeded = _.isNil(window.neo4jDesktopApi);

  if (fakeDesktopApiNeeded) {
    return (
      <Neo4jDesktopStandIn username='neo4j' password='admin' host='localhost' port='7687' name='shim'>
        <Halin key="app" connected={true} />
      </Neo4jDesktopStandIn>
    );
  } else {
    return (
      <GraphAppBase
        driverFactory={neo4j}
        integrationPoint={window.neo4jDesktopApi}
        render={({ connectionState, connectionDetails, setCredentials }) => {
          return (
            <Halin key="app" connected={connectionState === CONNECTED} />
          );
        }}
      />
    );
  }
};

export default App;
