/*
 * Copyright © 2019 Atomist, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { GitHubRepoRef } from "@atomist/automation-client";
import { scanFreePort } from "@atomist/automation-client/lib/util/port";
import {
    actionableButton,
    and,
    CommandHandlerRegistration,
    DoNotSetAnyGoals,
    execPromise,
    GeneratorRegistration,
    goal,
    hasFile,
    hasFileWithExtension,
    not,
    or,
    SdmGoalState,
    slackSuccessMessage,
} from "@atomist/sdm";
import {
    configure,
    Version,
} from "@atomist/sdm-core";
import {
    dotnetCoreBuilder,
    DotnetCoreProjectFileCodeTransform,
    DotnetCoreProjectVersioner,
    DotnetCoreVersionProjectListener,
    getDockerfile,
} from "@atomist/sdm-pack-analysis-dotnet";
import { Build } from "@atomist/sdm-pack-build";
import {
    DockerBuild,
    HasDockerfile,
} from "@atomist/sdm-pack-docker";
import {
    mavenBuilder,
    MavenProjectVersioner,
    MvnVersion,
    SpringProjectCreationParameterDefinitions,
    SpringProjectCreationParameters,
    TransformMavenSpringBootSeedToCustomProject,
} from "@atomist/sdm-pack-spring";
import {
    bold,
    codeLine,
    url,
} from "@atomist/slack-messages";
import { replaceSeedSlug } from "../transform/replaceSeedSlug";
import { UpdateReadmeTitle } from "../transform/updateReadmeTitle";

/**
 * Atomist SDM Sample
 * @description SDM to create and build Maven projects
 * @tag sdm,generator,maven
 * @instructions <p>Now that the SDM is up and running, create a new .NET Core
 *               project by running '@atomist create maven project' and
 *               observe how the SDM will build and dockerize the new project.
 *
 *               The docker build and run goals require a locally accessible
 *               docker daemon. Please make sure to configure your terminal for
 *               docker access.</p>
 */

// atomist:code-snippet:start=mavenGenerator
/**
 * Maven generator registration
 */
const MavenGenerator: GeneratorRegistration<SpringProjectCreationParameters> = {
    name: "MavenGenerator",
    intent: "create maven project",
    description: "Creates a new Maven project",
    tags: ["maven"],
    autoSubmit: true,
    parameters: SpringProjectCreationParameterDefinitions,
    startingPoint: GitHubRepoRef.from({ owner: "atomist-seeds", repo: "spring-rest", branch: "master" }),
    transform: [
        UpdateReadmeTitle,
        ...TransformMavenSpringBootSeedToCustomProject,
    ],
};
// atomist:code-snippet:end

export const configuration = configure(async sdm => {

    // Register the generator and stop command with the SDM
    sdm.addGeneratorCommand(MavenGenerator);

    // Version goal calculates a timestamped version for the build goal
    const versionGoal = new Version()
        .withVersioner(MavenProjectVersioner);

    // Build goal that runs "maven package", after running "mvn version" which
    // sets a unique version for the build
    const buildGoal = new Build(
        { displayName: "maven build" })
        .with({
            name: "maven-build",
            builder: mavenBuilder(),
        }).withProjectListener(MvnVersion);

    const mavenSpringBootRun = goal(
        { displayName: "maven spring boot run" },
        async gi => {
            const { goalEvent, progressLog } = gi;
            const port = await scanFreePort(8000, 8100);
            const appUrl = `http://localhost:${port}`;

            try {
                const result = await execPromise(
                    "mvn",
                    ["spring-boot:run", `-Dspring-boot.run.arguments=--server.port=${port}`],
                );
                await gi.addressChannels(
                    slackSuccessMessage(
                        "Maven Spring Boot Run",
                        `Successfully started ${codeLine(goalEvent.sha.slice(0, 7))} at ${url(appUrl)}`,
                        {},
                    ),
                    { });

                return {
                    state: SdmGoalState.success,
                    externalUrls: [
                        { label: "http", url: appUrl },
                    ],
                };

            } catch (e) {
                progressLog.write(`Container run command failed: %s`, e.message);
                return {
                    code: 1,
                };
            }
        },
    );

    // This SDM has three PushRules: no goals, build and docker
    return {
        no_goals: {
            test: not(hasFile("pom.xml")),
            goals: DoNotSetAnyGoals.andLock(),
        },
        build: {
            goals: [
                buildGoal,
            ],
        },
        run: {
            dependsOn: "build",
            goals: [
                mavenSpringBootRun,
            ],
        },
    };
}, { name: "maven" });

/**
 * Read the Docker hostname from the DOCKER_HOST environment variable
 */
function readDockerHost(): string | undefined {
    const dockerhost = process.env.DOCKER_HOST;
    if (!dockerhost) {
        throw new Error("DOCKER_HOST environment variable not set");
    }
    return new URL(dockerhost).hostname;
}