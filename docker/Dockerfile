FROM rsksmart/rskj:IRIS-3

COPY node.conf ./node.conf
COPY logback.xml ./logback.xml

RUN mkdir -p /root/.rsk/regtest/database
RUN chmod -R 777 /root/.rsk

ENTRYPOINT ["java", \
    "-Drsk.conf.file=./node.conf", \
    "-Dlogback.configurationFile=./logback.xml", \
    "-cp", "./rsk.jar", "co.rsk.Start" ]
