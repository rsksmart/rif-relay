FROM openjdk:8-jdk-slim-buster as build
RUN apt-get update -y && \
    apt-get install -y git curl gnupg && \
    rm -rf /var/lib/apt/lists/* && \
    apt-get autoremove -y && \
    apt-get clean

RUN gpg --keyserver https://secchannel.rsk.co/release.asc --recv-keys 1A92D8942171AFA951A857365DECF4415E3B8FA4
RUN gpg --finger 1A92D8942171AFA951A857365DECF4415E3B8FA4

ARG rskj_codename=IRIS
ARG rskj_version=3.3.0
ARG working_branch=IRIS-3.3.0

RUN git clone --single-branch --depth 1 --branch "${working_branch}" https://github.com/rsksmart/rskj.git /code/rskj

WORKDIR /code/rskj

RUN gpg --verify SHA256SUMS.asc
RUN sha256sum --check SHA256SUMS.asc
RUN ./configure.sh
RUN ./gradlew --no-daemon clean build -x test

FROM openjdk:8-jdk-slim-buster

ARG rskj_codename=IRIS
ARG rskj_version=3.3.0

WORKDIR /usr/local/rskj
COPY --from=build /code/rskj/rskj-core/build/libs/rskj-core-${rskj_version}-${rskj_codename}-all.jar ./rsk.jar
COPY node.conf ./node.conf
COPY logback.xml ./logback.xml

RUN mkdir -p /root/.rsk/regtest/database
RUN chmod -R 777 /root/.rsk

ENTRYPOINT ["java", \
    "-Drsk.conf.file=./node.conf", \
    "-Dlogback.configurationFile=./logback.xml", \
    "-cp", "./rsk.jar", "co.rsk.Start" ]
