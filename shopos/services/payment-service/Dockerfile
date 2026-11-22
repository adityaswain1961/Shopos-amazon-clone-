FROM mcr.microsoft.com/dotnet/sdk:8.0 AS builder
WORKDIR /src
COPY PaymentService.csproj .
RUN dotnet restore
COPY . .
RUN dotnet publish -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:8.0
WORKDIR /app
COPY --from=builder /app .
ENV ASPNETCORE_URLS=http://+:3008 \
    DOTNET_gcServer=1 \
    DOTNET_TieredPGO=1
# aspnet images ship a non-root user; APP_UID is its numeric id (1654).
# Numeric so Kubernetes runAsNonRoot can verify it.
USER $APP_UID
EXPOSE 3008
ENTRYPOINT ["dotnet", "PaymentService.dll"]
