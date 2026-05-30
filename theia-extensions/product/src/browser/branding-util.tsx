/********************************************************************************
 * Copyright (C) 2025 Airone and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 *
 * SPDX-License-Identifier: MIT
 ********************************************************************************/

import { WindowService } from '@theia/core/lib/browser/window/window-service';
import * as React from 'react';
import { getBrandingVariant } from './theia-ide-config';

export interface ExternalBrowserLinkProps {
    text: string;
    url: string;
    windowService: WindowService;
}

export function renderProductName(): React.ReactNode {
    const variant = getBrandingVariant();
    const suffix = variant !== 'stable' ? ` ${variant.charAt(0).toUpperCase() + variant.slice(1)}` : '';
    return <h1>Airone <span className="gs-blue-header">IDE</span>{suffix}</h1>;
}

function BrowserLink(props: ExternalBrowserLinkProps): JSX.Element {
    return <a
        role={'button'}
        tabIndex={0}
        href={props.url}
        target='_blank'
    >
        {props.text}
    </a>;
}

export function renderWhatIs(windowService: WindowService): React.ReactNode {
    return <div className='gs-section'>
        <h3 className='gs-section-header'>
            What is this?
        </h3>
        <div>
            Airone IDE is a modern robotics programming environment for building and programming robots
            with the <BrowserLink text=".airo language" url="https://github.com/eesha000009-dev/airone-ide"
                windowService={windowService} ></BrowserLink>.
            Compile .airo programs to ESP32 microcontrollers, monitor serial output, and sync with your AI Backbone.
        </div>
        <div>
            Airone IDE is built on the <BrowserLink text="Eclipse Theia platform"
                url="https://theia-ide.org" windowService={windowService} ></BrowserLink>, providing a
            robust, extensible foundation for professional robotics development.
        </div>
    </div>;
}

export function renderExtendingCustomizing(windowService: WindowService): React.ReactNode {
    return <div className='gs-section'>
        <h3 className='gs-section-header'>
            Extending Airone IDE
        </h3>
        <div >
            You can extend Airone IDE at runtime by installing VS Code extensions, e.g. from the <BrowserLink text="OpenVSX registry" url="https://open-vsx.org/"
                windowService={windowService} ></BrowserLink>, an open marketplace for VS Code extensions. Just open the extension view or browse <BrowserLink
                    text="OpenVSX online" url="https://open-vsx.org/" windowService={windowService} ></BrowserLink>.
        </div>
        <div>
            Airone IDE supports custom .airo language extensions and robotics-specific tooling. Visit the
                <BrowserLink text="Airone IDE repository" url="https://github.com/eesha000009-dev/airone-ide"
                    windowService={windowService} ></BrowserLink> to learn more about building extensions for the Airone ecosystem.
        </div>
    </div>;
}

export function renderSupport(windowService: WindowService): React.ReactNode {
    return <div className='gs-section'>
        <h3 className='gs-section-header'>
            Support
        </h3>
        <div>
            For support with Airone IDE, please visit the <BrowserLink text="Airone IDE GitHub" url="https://github.com/eesha000009-dev/airone-ide"
                windowService={windowService} ></BrowserLink>. You can find documentation, report issues, and connect with the community there.
        </div>
    </div>;
}

export function renderTickets(windowService: WindowService): React.ReactNode {
    return <div className='gs-section'>
        <h3 className='gs-section-header'>
            Reporting feature requests and bugs
        </h3>
        <div >
            If you encounter a bug in Airone IDE or have a feature request, please
            <BrowserLink text=" open an issue on GitHub" url="https://github.com/eesha000009-dev/airone-ide/issues/new/choose"
                windowService={windowService} ></BrowserLink>.
        </div>
        <div>
            For issues related to the underlying Theia platform, please consider opening an issue in
            the <BrowserLink text="Theia project on GitHub" url="https://github.com/eclipse-theia/theia/issues/new/choose"
                windowService={windowService} ></BrowserLink>.
        </div>
    </div>;
}

export function renderSourceCode(windowService: WindowService): React.ReactNode {
    return <div className='gs-section'>
        <h3 className='gs-section-header'>
            Source Code
        </h3>
        <div >
            The source code of Airone IDE is available
            on <BrowserLink text="GitHub" url="https://github.com/eesha000009-dev/airone-ide"
                windowService={windowService} ></BrowserLink>.
        </div>
    </div>;
}

export function renderDocumentation(windowService: WindowService): React.ReactNode {
    return <div className='gs-section'>
        <h3 className='gs-section-header'>
            Documentation
        </h3>
        <div >
            Please see the <BrowserLink text="Airone IDE documentation" url="https://github.com/eesha000009-dev/airone-ide#readme"
                windowService={windowService} ></BrowserLink> on how to use Airone IDE for robotics programming.
        </div>
    </div>;
}

export function renderCollaboration(windowService: WindowService): React.ReactNode {
    return <div className='gs-section'>
        <h3 className='gs-section-header'>
            AI Backbone
        </h3>
        <div >
            Airone IDE connects to your AI Backbone for intelligent code assistance, robot configuration,
            and deployment management. Configure your AI Backbone connection in the settings to get started.
        </div>
    </div>;
}

export function renderDownloads(): React.ReactNode {
    return <div className='gs-section'>
        <h3 className='gs-section-header'>
            Updates and Downloads
        </h3>
        <div className='gs-action-container'>
            You can update Airone IDE directly in this application by navigating to
            File {'>'} Preferences {'>'} Check for Updates… Moreover the application will check for updates
            after each launch automatically.
        </div>
        <div className='gs-action-container'>
            Alternatively you can download the most recent version from the
                <a href="https://github.com/eesha000009-dev/airone-ide/releases" target='_blank' rel='noreferrer'>Airone IDE releases page</a>.
        </div>
    </div>;
}
