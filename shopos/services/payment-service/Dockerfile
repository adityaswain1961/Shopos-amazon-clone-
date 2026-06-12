FROM mcr.microsoft.com/dotnet/sdk:8.0 AS builder
WORKDIR /src
COPY PaymentService.csproj .
COPY . .
RUN dotnet restore && dotnet publish -c Release -o /app

FROM mcr.microsoft.com/dotnet/aspnet:8.0
WORKDIR /app
COPY --from=builder /app .
ENV ASPNETCORE_URLS=http://+:3008
EXPOSE 3008
ENTRYPOINT ["dotnet", "PaymentService.dll"]
